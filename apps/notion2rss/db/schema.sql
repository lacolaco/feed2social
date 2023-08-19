DROP TABLE IF EXISTS FeedItems;

CREATE TABLE IF NOT EXISTS FeedItems (
    id INTEGER PRIMARY KEY,
    notion_block_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);