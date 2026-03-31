import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  username = '';
  password = '';
  error    = '';
  loading  = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    if (!this.username.trim() || !this.password) return;
    this.loading = true;
    this.error   = '';

    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.error   = err.error?.error || 'Login failed. Please try again.';
        this.loading = false;
      },
    });
  }
}
