-- Satu server Postgres, database terpisah per aplikasi.
CREATE DATABASE medusa;
CREATE DATABASE hub;
CREATE DATABASE hub_test;
\c hub_test
CREATE EXTENSION IF NOT EXISTS vector;
\c hub
CREATE EXTENSION IF NOT EXISTS vector;
