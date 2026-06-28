-- Seed data for the MySQL test database. Runs once on first container start
-- (docker-entrypoint-initdb.d). Mirrors the Postgres seed: a range of types, a
-- view, a routine, a primary key, a NOT NULL default, and a generated column.

CREATE TABLE authors (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255) UNIQUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE books (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    author_id   INT NOT NULL,
    title       VARCHAR(255) NOT NULL,
    price       DECIMAL(10, 2) NOT NULL DEFAULT 0,
    in_stock    BOOLEAN NOT NULL DEFAULT TRUE,
    metadata    JSON,
    title_upper VARCHAR(255) AS (UPPER(title)) STORED,
    published   DATE,
    CONSTRAINT fk_books_author FOREIGN KEY (author_id) REFERENCES authors (id)
);

CREATE VIEW books_in_stock AS
SELECT b.id, b.title, a.name AS author, b.price
FROM books b
JOIN authors a ON a.id = b.author_id
WHERE b.in_stock;

DELIMITER //
CREATE FUNCTION author_book_count(author INT)
RETURNS BIGINT
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE total BIGINT;
    SELECT COUNT(*) INTO total FROM books WHERE author_id = author;
    RETURN total;
END //

CREATE PROCEDURE list_authors()
BEGIN
    SELECT id, name, email FROM authors ORDER BY name;
END //
DELIMITER ;

INSERT INTO authors (name, email) VALUES
    ('Ursula K. Le Guin', 'ursula@example.com'),
    ('Terry Pratchett', 'terry@example.com'),
    ('Octavia Butler', NULL);

INSERT INTO books (author_id, title, price, in_stock, metadata, published) VALUES
    (1, 'A Wizard of Earthsea', 12.99, TRUE, '{"pages": 183}', '1968-01-01'),
    (1, 'The Left Hand of Darkness', 14.50, TRUE, '{"pages": 304}', '1969-03-01'),
    (2, 'Mort', 9.99, FALSE, '{"series": "Discworld"}', '1987-11-12'),
    (3, 'Kindred', 11.25, TRUE, '{}', '1979-06-01');
