import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

// argon2id with the OWASP-recommended minimum cost (19 MiB memory, 2 passes, 1 lane).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  // A real hash of a throwaway value. Login verifies against it when the email is unknown, so an
  // unknown email and a wrong password take the same time and cannot be told apart by timing.
  private readonly dummyHash = hash("not-a-real-password", OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(storedHash: string | null, password: string): Promise<boolean> {
    try {
      return await verify(storedHash ?? (await this.dummyHash), password);
    } catch {
      return false; // malformed hash or similar: treat as a failed login, never a 500
    }
  }
}
