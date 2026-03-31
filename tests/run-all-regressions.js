'use strict';

async function main() {
    console.log('========================================');
    console.log(' SSC V2 — Full Regression Suite');
    console.log('========================================\n');

    const suites = [
        { name: 'Day 22: Approval Governance', run: require('./day22-approval-governance-tests').runTests },
        { name: 'Day 23: Workflow Execution',  run: require('./day23-workflow-execution-tests').runTests },
        { name: 'Day 24: Input Validation',    run: require('./day24-input-validation-tests').runTests },
    ];

    let totalPassed = 0;
    let totalFailed = 0;
    const results = [];

    for (const suite of suites) {
        console.log('\n>>> ' + suite.name + '\n');
        try {
            const r = await suite.run();
            totalPassed += r.passed || 0;
            totalFailed += r.failed || 0;
            results.push({ name: suite.name, ...r });
        } catch (err) {
            console.error('  CRASHED: ' + err.message);
            totalFailed += 1;
            results.push({ name: suite.name, passed: 0, failed: 1, error: err.message });
        }
    }

    console.log('\n========================================');
    console.log(' REGRESSION SUMMARY');
    console.log('========================================');
    for (const s of results) {
        console.log('  ' + ((s.failed || 0) === 0 ? '✓' : '✗') + ' ' + s.name + ': ' + (s.passed || 0) + ' passed, ' + (s.failed || 0) + ' failed');
    }
    console.log('----------------------------------------');
    console.log('  TOTAL: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
    console.log('========================================\n');

    process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
