import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { z } from "zod";

// Validates a request body against a zod schema and returns the parsed (trimmed, lowercased) value.
export class ZodPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: result.error.issues[0]?.message ?? "Invalid request",
        issues: result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    return result.data;
  }
}
