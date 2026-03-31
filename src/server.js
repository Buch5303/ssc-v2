'use strict';

const { initDatabase } = require('./db/database');
const { runMigrations } = require('./db/migrate');
const { createApp } = require('./app/integration');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DB_PATH = process.env.DB_PATH || undefined;

async function main() {
    console.log('========================================');
    console.log(' SSC Supply Chain V2');
    console.log('========================================');

    const db = await initDatabase(DB_PATH);
    const mig = runMigrations(db);
    console.log('[boot] Migrations: ' + mig.applied.length + ' applied, ' + mig.skipped.length + ' skipped');

    if (mig.errors.length) {
        console.error('[boot] FATAL — migration errors:');
        mig.errors.forEach(e => console.error('  ' + e));
        process.exit(1);
    }

    const app = createApp(db);
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log('[boot] Listening on 0.0.0.0:' + PORT);
        console.log('[boot] http://localhost:' + PORT + '/health');
        console.log('========================================\n');
    });

    function shutdown(sig) {
        console.log('\n[shutdown] ' + sig);
        server.close(() => { db.close(); process.exit(0); });
        setTimeout(() => process.exit(1), 10000);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
    console.error('[FATAL] ' + err.message + '\n' + err.stack);
    process.exit(1);
});
