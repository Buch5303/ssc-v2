'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'ssc-v2.db');

async function initDatabase(dbPath) {
    const resolved = dbPath === undefined ? DEFAULT_DB_PATH : dbPath;
    const SQL = await initSqlJs();

    let rawDb;
    if (resolved && fs.existsSync(resolved)) {
        rawDb = new SQL.Database(fs.readFileSync(resolved));
        console.log('[db] Loaded ' + resolved);
    } else {
        rawDb = new SQL.Database();
        console.log('[db] New database' + (resolved ? ' → ' + resolved : ' (in-memory)'));
    }

    rawDb.run('PRAGMA journal_mode = WAL');
    rawDb.run('PRAGMA foreign_keys = ON');

    let inTx = false;
    const TX_B = /^\s*(BEGIN|SAVEPOINT)/i;
    const TX_E = /^\s*(COMMIT|END|ROLLBACK|RELEASE)/i;

    function persist() {
        if (!resolved || inTx) return;
        try {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(resolved, Buffer.from(rawDb.export()));
        } catch (err) {
            console.error('[db] persist error:', err.message);
        }
    }

    const db = {
        _raw: rawDb,
        _path: resolved,

        exec(sql) {
            if (TX_B.test(sql)) inTx = true;
            rawDb.run(sql);
            if (TX_E.test(sql)) { inTx = false; persist(); }
            else if (!inTx) persist();
        },

        prepare(sql) {
            return {
                run(...params) {
                    rawDb.run(sql, params);
                    const idRes = rawDb.exec('SELECT last_insert_rowid() AS id');
                    const lastId = idRes.length > 0 ? idRes[0].values[0][0] : null;
                    const changes = rawDb.getRowsModified();
                    if (!inTx) persist();
                    return { lastInsertRowid: lastId, changes };
                },
                get(...params) {
                    const stmt = rawDb.prepare(sql);
                    stmt.bind(params);
                    if (stmt.step()) {
                        const cols = stmt.getColumnNames();
                        const vals = stmt.get();
                        stmt.free();
                        const row = {};
                        cols.forEach((c, i) => { row[c] = vals[i]; });
                        return row;
                    }
                    stmt.free();
                    return undefined;
                },
                all(...params) {
                    const res = rawDb.exec(sql, params);
                    if (!res || res.length === 0) return [];
                    const cols = res[0].columns;
                    return res[0].values.map(vals => {
                        const row = {};
                        cols.forEach((c, i) => { row[c] = vals[i]; });
                        return row;
                    });
                },
            };
        },

        pragma(str) { try { rawDb.run('PRAGMA ' + str); } catch {} },
        transaction: undefined,
        save() { persist(); },
        close() { persist(); rawDb.close(); console.log('[db] Closed'); },
    };

    return db;
}

module.exports = { initDatabase };
