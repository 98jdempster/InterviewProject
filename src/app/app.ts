import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from './auth/auth.service';

interface Car {
  make: string;
  model: string;
  color: string;
  condition: string;
  price: number;
}

interface FacetOption {
  value: string;
  count: number;
  selected: boolean;
}

interface FacetGroup {
  key: keyof Car;
  label: string;
  options: FacetOption[];
  expanded: boolean;
  searchQuery: string;
  showSearch: boolean;  // true when facet has many options
}

interface ColumnDef {
  key: keyof Car;
  label: string;
  width: number;       // current width in px
  minWidth: number;
}

const COLOR_MAP: Record<string, string> = {
  'Black': '#1a1a1a', 'White': '#f0ede8', 'Silver': '#b8b4ad',
  'Gray': '#7a756e', 'Red': '#c93d3d', 'Blue': '#3572b0',
  'Green': '#3a8a52', 'Navy': '#243255', 'Burgundy': '#7a2030',
  'Charcoal': '#3d3a36', 'Pearl White': '#ece8df',
  'Midnight Blue': '#1a2040', 'Bronze': '#a97840',
  'Champagne': '#e8dcc6', 'Orange': '#d06828',
  'Dark Green': '#285a35', 'Ice Blue': '#8ab8d4', 'Graphite': '#4a4744',
};

const COND_ORDER: Record<string, number> = {
  'Excellent': 0, 'Good': 1, 'Fair': 2, 'Poor': 3
};

const FACET_SEARCH_THRESHOLD = 6; // Show search box when facet has this many options

// ══════════════════════════════════════════════════════════════
// INPUT SANITIZATION
// ══════════════════════════════════════════════════════════════
// Security considerations for user-supplied input:
//
// 1. XSS Prevention:
//    Angular's template binding ({{ }}) auto-escapes HTML by default,
//    so rendered text is safe from script injection. We do NOT use
//    [innerHTML] or bypassSecurityTrust anywhere in this application.
//
// 2. Input Sanitization:
//    All user text inputs (global search, facet search, price fields)
//    are sanitized before use via sanitizeInput() which strips HTML
//    tags, trims whitespace, and enforces a max length. This provides
//    defense-in-depth even though Angular's binding already escapes.
//
// 3. No SQL/NoSQL Injection Surface:
//    This app performs client-side filtering on a static JSON dataset.
//    There are no database queries, API calls with user input, or
//    server-side operations. If this were extended to a backend, all
//    user inputs should be parameterized — never concatenated into
//    queries. The sanitizeInput() layer here ensures that if a backend
//    is added later, inputs are already pre-cleaned.
//
// 4. Price Input Validation:
//    Numeric inputs are parsed with parseInt/parseFloat and clamped
//    to valid bounds. NaN values are rejected and reset to defaults.
//
// 5. CSP Compatibility:
//    No inline event handlers or eval() usage. All logic is in the
//    component class, compatible with strict Content-Security-Policy.
// ══════════════════════════════════════════════════════════════

const MAX_INPUT_LENGTH = 200;

/** Strip HTML tags, collapse whitespace, enforce max length. */
function sanitizeInput(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')       // strip HTML tags
    .replace(/[^\w\s\-.,'']/g, '') // allow only alphanumeric, spaces, hyphens, periods, commas, apostrophes
    .trim()
    .slice(0, MAX_INPUT_LENGTH);
}

/** Validate a numeric input, returning fallback if invalid. */
function sanitizeNumber(value: any, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(n) || !isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App implements OnInit {
  allCars: Car[] = [];
  filteredCars: Car[] = [];
  paginatedCars: Car[] = [];
  facets: FacetGroup[] = [];

  selectedFilters: Map<keyof Car, Set<string>> = new Map();
  searchQuery = '';
  sortKey: keyof Car = 'price';
  sortDir: 'asc' | 'desc' = 'asc';
  sidebarOpen = true;

  priceMin = 0;
  priceMax = 200000;
  priceActive = false;
  absMin = 0;
  absMax = 200000;

  // ── Pagination ──
  currentPage = 1;
  pageSize = 25;
  pageSizeOptions = [10, 25, 50, 100];
  totalPages = 1;

  // ── Column resizing ──
  // width = current min-width in px (draggable), minWidth = absolute floor
  columns: ColumnDef[] = [
    { key: 'make',      label: 'Make',      width: 100, minWidth: 80 },
    { key: 'model',     label: 'Model',     width: 100, minWidth: 80 },
    { key: 'color',     label: 'Color',     width: 120, minWidth: 80 },
    { key: 'condition', label: 'Condition', width: 100, minWidth: 80 },
    { key: 'price',     label: 'Price',     width: 100, minWidth: 80 },
  ];
  resizingCol: ColumnDef | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  readonly facetKeys: { key: keyof Car; label: string }[] = [
    { key: 'make', label: 'Make' },
    { key: 'condition', label: 'Condition' },
    { key: 'color', label: 'Color' },
    { key: 'model', label: 'Model' },
  ];

  constructor(private http: HttpClient, private auth: AuthService) {
    this.facetKeys.forEach(f => this.selectedFilters.set(f.key, new Set()));
  }

  ngOnInit(): void {
    this.http.get<Car[]>('/api/cars', { headers: this.auth.getAuthHeaders() }).subscribe({
      next: (cars) => {
        this.allCars = cars;
        const prices = cars.map(c => c.price);
        this.absMin = Math.floor(Math.min(...prices) / 1000) * 1000;
        this.absMax = Math.ceil(Math.max(...prices) / 1000) * 1000;
        this.priceMin = this.absMin;
        this.priceMax = this.absMax;
        this.update();
      },
      error: (err) => {
        if (err.status === 401) this.auth.logout();
        else console.error('Failed to load cars:', err);
      },
    });
  }

  logout(): void { this.auth.logout(); }
  getUsername(): string | null { return this.auth.getUsername(); }

  // ══════════════════════════════════
  // Core update
  // ══════════════════════════════════

  update(): void {
    this.filteredCars = this.getFilteredCars();
    this.facets = this.buildFacets();
    this.totalPages = Math.max(1, Math.ceil(this.filteredCars.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    this.paginatedCars = this.getPaginatedCars();
  }

  getFilteredCars(): Car[] {
    let cars = [...this.allCars];

    this.selectedFilters.forEach((vals, key) => {
      if (vals.size > 0) {
        cars = cars.filter(c => vals.has(String(c[key])));
      }
    });

    if (this.priceActive) {
      cars = cars.filter(c => c.price >= this.priceMin && c.price <= this.priceMax);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      cars = cars.filter(c =>
        c.make.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        c.color.toLowerCase().includes(q) ||
        c.condition.toLowerCase().includes(q)
      );
    }

    cars.sort((a, b) => {
      let av: any = a[this.sortKey];
      let bv: any = b[this.sortKey];
      if (this.sortKey === 'condition') { av = COND_ORDER[av]; bv = COND_ORDER[bv]; }
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return this.sortDir === 'asc' ? cmp : -cmp;
    });

    return cars;
  }

  getPaginatedCars(): Car[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredCars.slice(start, start + this.pageSize);
  }

  buildFacets(): FacetGroup[] {
    return this.facetKeys.map(({ key, label }) => {
      let contextCars = [...this.allCars];
      this.selectedFilters.forEach((vals, fk) => {
        if (fk !== key && vals.size > 0) {
          contextCars = contextCars.filter(c => vals.has(String(c[fk])));
        }
      });
      if (this.priceActive) {
        contextCars = contextCars.filter(c => c.price >= this.priceMin && c.price <= this.priceMax);
      }
      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase();
        contextCars = contextCars.filter(c =>
          c.make.toLowerCase().includes(q) || c.model.toLowerCase().includes(q) ||
          c.color.toLowerCase().includes(q) || c.condition.toLowerCase().includes(q)
        );
      }

      const countMap = new Map<string, number>();
      contextCars.forEach(c => {
        const v = String(c[key]);
        countMap.set(v, (countMap.get(v) || 0) + 1);
      });

      const selected = this.selectedFilters.get(key)!;
      const existing = this.facets.find(f => f.key === key);

      const options: FacetOption[] = Array.from(countMap.entries())
        .map(([value, count]) => ({ value, count, selected: selected.has(value) }))
        .sort((a, b) => b.count - a.count);

      return {
        key, label, options,
        expanded: existing ? existing.expanded : true,
        searchQuery: existing ? existing.searchQuery : '',
        showSearch: options.length >= FACET_SEARCH_THRESHOLD,
      };
    });
  }

  // ══════════════════════════════════
  // Facet search filtering
  // ══════════════════════════════════

  getFilteredFacetOptions(facet: FacetGroup): FacetOption[] {
    if (!facet.searchQuery.trim()) return facet.options;
    const q = sanitizeInput(facet.searchQuery).toLowerCase();
    if (!q) return facet.options;
    return facet.options.filter(o => o.value.toLowerCase().includes(q));
  }

  onFacetSearchChange(facet: FacetGroup): void {
    facet.searchQuery = sanitizeInput(facet.searchQuery);
  }

  // ══════════════════════════════════
  // Pagination
  // ══════════════════════════════════

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.paginatedCars = this.getPaginatedCars();
  }

  onPageSizeChange(event: Event): void {
    this.pageSize = parseInt((event.target as HTMLSelectElement).value, 10);
    this.currentPage = 1;
    this.update();
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  get paginationStart(): number {
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get paginationEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredCars.length);
  }

  // ══════════════════════════════════
  // Column resizing
  // ══════════════════════════════════

  onResizeStart(event: MouseEvent, col: ColumnDef): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizingCol = col;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = col.width;
  }

  @HostListener('document:mousemove', ['$event'])
  onResizeMove(event: MouseEvent): void {
    if (!this.resizingCol) return;
    const delta = event.clientX - this.resizeStartX;
    this.resizingCol.width = Math.max(this.resizingCol.minWidth, this.resizeStartWidth + delta);
  }

  @HostListener('document:mouseup')
  onResizeEnd(): void {
    this.resizingCol = null;
  }

  // ══════════════════════════════════
  // Filter actions (unchanged)
  // ══════════════════════════════════

  toggleFilter(key: keyof Car, value: string): void {
    const set = this.selectedFilters.get(key)!;
    if (set.has(value)) set.delete(value); else set.add(value);
    this.currentPage = 1;
    this.update();
  }

  removeChip(key: keyof Car, value: string): void {
    this.selectedFilters.get(key)!.delete(value);
    this.currentPage = 1;
    this.update();
  }

  onSearchChange(): void {
    this.searchQuery = sanitizeInput(this.searchQuery);
    this.currentPage = 1;
    this.update();
  }

  onSortChange(event: Event): void {
    const [k, d] = (event.target as HTMLSelectElement).value.split(':');
    this.sortKey = k as keyof Car;
    this.sortDir = d as 'asc' | 'desc';
    this.update();
  }

  onColumnSort(key: keyof Car): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
    this.update();
  }

  applyPrice(): void {
    this.priceMin = sanitizeNumber(this.priceMin, this.absMin, 0, 10_000_000);
    this.priceMax = sanitizeNumber(this.priceMax, this.absMax, 0, 10_000_000);
    if (this.priceMin > this.priceMax) {
      [this.priceMin, this.priceMax] = [this.priceMax, this.priceMin];
    }
    this.priceActive = true;
    this.currentPage = 1;
    this.update();
  }

  clearPrice(): void {
    this.priceActive = false;
    this.priceMin = this.absMin;
    this.priceMax = this.absMax;
    this.currentPage = 1;
    this.update();
  }

  clearAll(): void {
    this.selectedFilters.forEach(s => s.clear());
    this.searchQuery = '';
    this.currentPage = 1;
    this.clearPrice();
  }

  toggleFacet(facet: FacetGroup): void {
    facet.expanded = !facet.expanded;
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  // ══════════════════════════════════
  // Helpers (unchanged)
  // ══════════════════════════════════

  getActiveChips(): { key: keyof Car; label: string; value: string }[] {
    const chips: { key: keyof Car; label: string; value: string }[] = [];
    this.selectedFilters.forEach((vals, key) => {
      const label = this.facetKeys.find(f => f.key === key)?.label || key;
      vals.forEach(v => chips.push({ key, label, value: v }));
    });
    return chips;
  }

  hasActiveFilters(): boolean {
    let has = false;
    this.selectedFilters.forEach(s => { if (s.size > 0) has = true; });
    return has || this.priceActive || this.searchQuery.trim().length > 0;
  }

  selectedCount(facet: FacetGroup): number {
    return this.selectedFilters.get(facet.key)?.size || 0;
  }

  getColorSwatch(color: string): string {
    return COLOR_MAP[color] || '#999';
  }

  isLightColor(color: string): boolean {
    return ['White', 'Pearl White', 'Champagne', 'Silver'].includes(color);
  }

  condClass(cond: string): string {
    return 'cond-' + cond.toLowerCase();
  }

  formatPrice(price: number): string {
    return '$' + price.toLocaleString();
  }

  sortArrow(key: string): string {
    if (this.sortKey !== key) return '▲';
    return this.sortDir === 'asc' ? '▲' : '▼';
  }
}
