-- Satu server Postgres, database terpisah per aplikasi.
CREATE DATABASE medusa;
CREATE DATABASE hub;
\c hub
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS hub;
