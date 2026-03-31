// ============================================================
// SQLite compatibility wrapper (sql.js → better-sqlite3 API)
// For test environments without native module support.
// ============================================================

'use strict';

const initSqlJs = require('sql.js');

async function createDatabase() {
    const SQL = await initSqlJs();
    const rawDb = new SQL.Database();

    const db = {
        _raw: rawDb,

        exec(sql) {
            rawDb.run(sql);
        },

        prepare(sql) {
            return {
                run(...params) {
                    rawDb.run(sql, params);
                    const idResult = rawDb.exec('SELECT last_insert_rowid() as id');
                    const lastId = idResult.length > 0 ? idResult[0].values[0][0] : null;
                    return { lastInsertRowid: lastId, changes: rawDb.getRowsModified() };
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
                    const results = rawDb.exec(sql, params);
                    if (!results || results.length === 0) return [];
                    const cols = results[0].columns;
                    return results[0].values.map(vals => {
                        const row = {};
                        cols.forEach((c, i) => { row[c] = vals[i]; });
                        return row;
                    });
                },
            };
        },

        pragma(str) {
            try { rawDb.run(`PRAGMA ${str}`); } catch { /* ignore */ }
        },

        // sql.js doesn't support .transaction() natively; manual BEGIN/COMMIT used
        transaction: undefined,

        close() { rawDb.close(); },
    };

    return db;
}

module.exports = { createDatabase };
