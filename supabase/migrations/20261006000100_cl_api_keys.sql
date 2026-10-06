-- ClearLedger gets its own API key table (it previously shared MeridianGL's gl_api_keys).
CREATE TABLE IF NOT EXISTS cl_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Demo API key: "demo-key-clearledger"
INSERT INTO cl_api_keys (key_hash, label)
SELECT '2093db633edc2c04712a486f20ba4fe45e0af387b6bc0ecb1fd216b06df4094f', 'Demo key — participants'
WHERE NOT EXISTS (SELECT 1 FROM cl_api_keys WHERE key_hash = '2093db633edc2c04712a486f20ba4fe45e0af387b6bc0ecb1fd216b06df4094f');
