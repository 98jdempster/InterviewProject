import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent {
  username = '';
  password = '';
  confirm  = '';
  error    = '';
  loading  = false;

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    if (!this.username.trim() || !this.password) return;

    if (this.password !== this.confirm) {
      this.error = 'Passwords do not match.';
      return;
    }
    if (this.password.length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }

    this.loading = true;
    this.error   = '';

    this.auth.register(this.username.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.error   = err.error?.error || 'Registration failed. Please try again.';
        this.loading = false;
      },
    });
  }
}
