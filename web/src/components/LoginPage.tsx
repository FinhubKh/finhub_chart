import React, { useState } from "react";
import "./LoginPage.css";

type Props = {
  onLogin: () => void;
};

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("test@finhubkh.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Placeholder logic for authentication
    // TODO: Connect this to the actual backend API to verify credentials
    if (email.trim() && password.trim()) {
      onLogin();
    } else {
      setError("Please enter your email and password.");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="FinHubKh Logo" className="login-logo" />
          <h2>Welcome to FinHubKh</h2>
          <p>Sign in with your FinHub member account to access advanced charts.</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@finhubkh.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="login-button">
            Login
          </button>
        </form>

        <div className="login-footer">
          <p>Don't have an account?</p>
          <a
            href="https://www.finhubkh.com/en/register"
            target="_blank"
            rel="noopener noreferrer"
            className="register-link"
          >
            Register as a FinHub member here
          </a>
        </div>
      </div>
    </div>
  );
}
