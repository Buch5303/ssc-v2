#!/usr/bin/env node --max-old-space-size=1024
'use strict';

async function main() {
    console.log('========================================');
    console.log(' SSC V2 — Full Regression Suite');
    console.log('========================================\n');

    const suites = [
        { name: 'Day 22: Approval Governance', run: require('./day22-approval-governance-tests').runTests },
        { name: 'Day 23: Workflow Execution',  run: require('./day23-workflow-execution-tests').runTests },
        { name: 'Day 24: Input Validation',    run: require('./day24-input-validation-tests').runTests },
        { name: 'Day 25: Auth Hardening',      run: require('./day25-auth-hardening-tests').runTests },
        { name: 'Day 26: Governance Hardening', run: require('./day26-governance-hardening-tests').runTests },
        { name: 'Day 27: Enforcement Architecture', run: require('./day27-enforcement-tests').runTests },
        { name: 'Day 28: Logging/Audit/RateLimit', run: require('./day28-logging-audit-ratelimit-tests').runTests },
        { name: 'Day 29: Distributed Infrastructure', run: require('./day29-distributed-infra-tests').runTests },
        { name: 'Day 30: EQS Audit Hardening', run: require('./day30-eqs-audit-tests').runTests },
        { name: 'Day 31: Grok Remediation', run: require('./day31-grok-remediation-tests').runTests },
        { name: 'Day 32: Production Backbone', run: require('./day32-production-backbone-tests').runTests },
        { name: 'Day 33: Supply Chain Data', run: require('./day33-supply-chain-data-tests').runTests },
        { name: 'Day 34: Query & API', run: require('./day34-query-api-tests').runTests },
        { name: 'Day 35: Pilot-Prep', run: require('./day35-pilot-prep-tests').runTests },
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
