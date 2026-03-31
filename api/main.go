package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	maxBodyBytes    = 1 << 20 // 1 MB — prevents request body exhaustion
	maxPasswordLen  = 72      // bcrypt silently truncates beyond 72 bytes
	maxUsernameLen  = 50
)

var (
	db        *pgxpool.Pool
	jwtSecret []byte
)

// ── Models ──────────────────────────────────────────────────

type Car struct {
	ID        int    `json:"id"`
	Make      string `json:"make"`
	Model     string `json:"model"`
	Color     string `json:"color"`
	Condition string `json:"condition"`
	Price     int    `json:"price"`
}

type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

type claims struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// ── Main ─────────────────────────────────────────────────────

func main() {
	jwtSecret = []byte(getEnv("JWT_SECRET", "dev-secret-change-in-production"))

	var err error
	db, err = pgxpool.New(context.Background(), getEnv("DATABASE_URL", "postgres://autovault:autovault@localhost:5432/autovault"))
	if err != nil {
		log.Fatalf("unable to connect to database: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Post("/api/auth/register", handleRegister)
	r.Post("/api/auth/login", handleLogin)
	r.With(requireAuth).Get("/api/cars", handleGetCars)

	port := getEnv("PORT", "8080")
	log.Printf("API server listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

// ── Auth handlers ─────────────────────────────────────────────

func handleRegister(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 3 || len(req.Username) > maxUsernameLen {
		jsonError(w, "username must be 3–50 characters", http.StatusBadRequest)
		return
	}
	if len(req.Password) < 6 || len(req.Password) > maxPasswordLen {
		jsonError(w, "password must be 6–72 characters", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("bcrypt error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	var id int
	err = db.QueryRow(context.Background(),
		"INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id",
		req.Username, string(hash),
	).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			jsonError(w, "username already taken", http.StatusConflict)
			return
		}
		log.Printf("db insert error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	token, err := makeToken(id, req.Username)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Set headers before WriteHeader so Content-Type is not dropped
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(AuthResponse{Token: token, Username: req.Username})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var id int
	var hash string
	err := db.QueryRow(context.Background(),
		"SELECT id, password_hash FROM users WHERE username = $1",
		strings.TrimSpace(req.Username),
	).Scan(&id, &hash)
	if err != nil {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := makeToken(id, req.Username)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	jsonOK(w, AuthResponse{Token: token, Username: req.Username})
}

// ── Cars handler ──────────────────────────────────────────────

func handleGetCars(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(context.Background(),
		"SELECT id, make, model, color, condition, price FROM cars ORDER BY id")
	if err != nil {
		log.Printf("db query error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cars := make([]Car, 0)
	for rows.Next() {
		var c Car
		if err := rows.Scan(&c.ID, &c.Make, &c.Model, &c.Color, &c.Condition, &c.Price); err != nil {
			log.Printf("row scan error: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		cars = append(cars, c)
	}

	jsonOK(w, cars)
}

// ── JWT ───────────────────────────────────────────────────────

func makeToken(userID int, username string) (string, error) {
	c := claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(jwtSecret)
}

func requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		c := &claims{}
		token, err := jwt.ParseWithClaims(tokenStr, c, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Helpers ───────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
