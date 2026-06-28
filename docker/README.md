# Test databases

Docker stack with seeded Postgres and MySQL instances for testing table-petch
against both engines.

## Usage

```sh
cd docker
docker compose up -d      # start (seeds run automatically on first boot)
docker compose down       # stop, keep data
docker compose down -v    # stop and wipe data (re-seeds next up)
```

## Connections

| Engine   | Host      | Port | User  | Password | Database |
| -------- | --------- | ---- | ----- | -------- | -------- |
| Postgres | localhost | 5434 | petch | petch    | petchdb  |
| MySQL    | localhost | 3306 | petch | petch    | petchdb  |

Each database is seeded with `authors` and `books` tables (PK, FK, NOT NULL
defaults, a generated column, JSON, and dates), a `books_in_stock` view, and an
`author_book_count` routine — enough to exercise browsing, editing, and the
routine view.
