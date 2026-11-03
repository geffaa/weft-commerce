import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261103093429 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "part_fitment" drop constraint if exists "part_fitment_sku_bike_model_id_unique";`);
    this.addSql(`alter table if exists "bike_model" drop constraint if exists "bike_model_make_model_year_from_unique";`);
    this.addSql(`create table if not exists "bike_model" ("id" text not null, "make" text not null, "model" text not null, "year_from" integer not null, "year_to" integer not null, "engine_cc" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "bike_model_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_bike_model_deleted_at" ON "bike_model" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bike_model_make_model_year_from_unique" ON "bike_model" ("make", "model", "year_from") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "part_fitment" ("id" text not null, "sku" text not null, "bike_model_id" text not null, "position" text check ("position" in ('front', 'rear', 'na')) not null default 'na', "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "part_fitment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_part_fitment_deleted_at" ON "part_fitment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_part_fitment_sku_bike_model_id_unique" ON "part_fitment" ("sku", "bike_model_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_part_fitment_bike_model_id" ON "part_fitment" ("bike_model_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "bike_model" cascade;`);

    this.addSql(`drop table if exists "part_fitment" cascade;`);
  }

}
