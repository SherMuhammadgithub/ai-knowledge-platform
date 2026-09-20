"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

type Mode = "login" | "register";
type Fields = { name: string; email: string; password: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the API rules so people see problems on blur. The API still validates everything.
function validate(mode: Mode, field: keyof Fields, value: string): string | undefined {
  if (field === "email") {
    if (!value.trim()) return "Enter your email";
    if (!EMAIL_PATTERN.test(value.trim())) return "Enter a valid email address";
  }
  if (field === "password") {
    if (!value) return "Enter your password";
    if (mode === "register" && value.length < 10) return "Use at least 10 characters";
  }
  return undefined;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isRegister = mode === "register";

  function onBlur(field: keyof Fields) {
    setErrors((e) => ({ ...e, [field]: validate(mode, field, values[field]) }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found: FieldErrors = {
      email: validate(mode, "email", values.email),
      password: validate(mode, "password", values.password),
    };
    setErrors(found);
    if (found.email || found.password) return;

    setPending(true);
    setFormError(null);
    try {
      await api<Me>(isRegister ? "/auth/register" : "/auth/login", {
        method: "POST",
        handleSessionLoss: false,
        body: {
          email: values.email,
          password: values.password,
          ...(isRegister && values.name.trim() ? { name: values.name } : {}),
        },
      });
      router.replace("/");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const next: FieldErrors = {};
        for (const issue of err.issues) next[issue.field as keyof Fields] = issue.message;
        setErrors(next);
      } else {
        setFormError(err instanceof ApiError ? err.message : "The request failed. Try again.");
      }
      setPending(false);
    }
  }

  const set = (field: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {isRegister && (
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" value={values.name} onChange={set("name")} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set("email")}
          onBlur={() => onBlur("email")}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            className="pr-10"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={values.password}
            onChange={set("password")}
            onBlur={() => onBlur("password")}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : isRegister ? "password-hint" : undefined}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </Button>
        </div>
        {errors.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {errors.password}
          </p>
        ) : (
          isRegister && (
            <p id="password-hint" className="text-sm text-muted-foreground">
              At least 10 characters.
            </p>
          )
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (isRegister ? "Creating account..." : "Signing in...") : isRegister ? "Create account" : "Sign in"}
      </Button>

      <p className="text-sm text-muted-foreground">
        {isRegister ? "Already have an account? " : "New here? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
