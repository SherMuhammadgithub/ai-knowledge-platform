import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export function Brand({ href = "/", className, onClick }: { href?: string; className?: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={cn("flex items-center gap-2.5 text-base font-semibold", className)}>
      <BrandMark className="size-6 shrink-0" />
      AI Knowledge Platform
    </Link>
  );
}
