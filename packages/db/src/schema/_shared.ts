import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** `uuid primary key default gen_random_uuid()` */
export const uuidPrimaryKey = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** `timestamptz not null default now()` */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** Soft delete on tenant business records. Queries filter it; RLS does not. */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true, mode: "date" });

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
