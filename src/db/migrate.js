'use strict';

const fs = require('fs');
const path = require('path');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations(db) {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const applied = [], skipped = [], errors = [];

    for (const file of files) {
        if (db.prepare('SELECT id FROM _migrations WHERE filename = ?').get(file)) {
            skipped.push(file);
            continue;
        }
        try {
            db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
            db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
            applied.push(file);
            console.log('[migrate] ✓ ' + file);
        } catch (err) {
            errors.push(file + ': ' + err.message);
            console.error('[migrate] ✗ ' + file + ' — ' + err.message);
        }
    }
    return { applied, skipped, errors };
}

if (require.main === module) {
    const { initDatabase } = require('./database');
    initDatabase().then(db => {
        const r = runMigrations(db);
        console.log('\n[migrate] ' + r.applied.length + ' applied, ' + r.skipped.length + ' skipped, ' + r.errors.length + ' errors');
        if (r.errors.length) { r.errors.forEach(e => console.error('  ' + e)); process.exit(1); }
        db.close();
    }).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runMigrations };
