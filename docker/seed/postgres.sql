-- Seed data for the Postgres test database. Runs once on first container start
-- (docker-entrypoint-initdb.d). Exercises a range of types, a view, a routine,
-- a primary key, a NOT NULL default, and a generated column.

CREATE TABLE authors (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    email       text UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE books (
    id          serial PRIMARY KEY,
    author_id   integer NOT NULL REFERENCES authors (id),
    title       text NOT NULL,
    price       numeric(10, 2) NOT NULL DEFAULT 0,
    in_stock    boolean NOT NULL DEFAULT true,
    tags        text[] DEFAULT '{}',
    metadata    jsonb DEFAULT '{}'::jsonb,
    title_upper text GENERATED ALWAYS AS (upper(title)) STORED,
    published   date
);

CREATE VIEW books_in_stock AS
SELECT b.id, b.title, a.name AS author, b.price
FROM books b
JOIN authors a ON a.id = b.author_id
WHERE b.in_stock;

CREATE FUNCTION author_book_count(author integer)
RETURNS bigint
LANGUAGE sql
AS $$
    SELECT count(*) FROM books WHERE author_id = author;
$$;

INSERT INTO authors (name, email) VALUES
    ('Ursula K. Le Guin', 'ursula@example.com'),
    ('Terry Pratchett', 'terry@example.com'),
    ('Octavia Butler', NULL);

INSERT INTO books (author_id, title, price, in_stock, tags, metadata, published) VALUES
    (1, 'A Wizard of Earthsea', 12.99, true, '{fantasy,classic}', '{"pages": 183}', '1968-01-01'),
    (1, 'The Left Hand of Darkness', 14.50, true, '{scifi}', '{"pages": 304}', '1969-03-01'),
    (2, 'Mort', 9.99, false, '{fantasy,humor}', '{"series": "Discworld"}', '1987-11-12'),
    (3, 'Kindred', 11.25, true, '{scifi,historical}', '{}', '1979-06-01');
