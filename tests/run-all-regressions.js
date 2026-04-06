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
        { name: 'Day 26: Governance Hardening',run: require('./day26-governance-hardening-tests').runTests },
        { name: 'Day 27: Enforcement',         run: require('./day27-enforcement-tests').runTests },
        { name: 'Day 28: Logging/Audit/Rate',  run: require('./day28-logging-audit-ratelimit-tests').runTests },
        { name: 'Day 29: Distributed Infra',   run: require('./day29-distributed-infra-tests').runTests },
        { name: 'Day 30: EQS Audit',           run: require('./day30-eqs-audit-tests').runTests },
        { name: 'Day 31: Grok Remediation',    run: require('./day31-grok-remediation-tests').runTests },
        { name: 'Day 32: Production Backbone', run: require('./day32-production-backbone-tests').runTests },
        { name: 'Day 33: Supply Chain Data',   run: require('./day33-supply-chain-data-tests').runTests },
        { name: 'Day 34: Query & API Expansion', run: require('./day34-query-api-tests').runTests },
    ];

    let grandPassed = 0;
    let grandFailed = 0;
    const failures = [];

    for (const suite of suites) {
        console.log('\n>>> Running ' + suite.name);
        const result = await suite.run();
        grandPassed += result.passed || 0;
        grandFailed += result.failed || 0;
        if (result.failures && result.failures.length) {
            failures.push({ suite: suite.name, failures: result.failures });
        }
    }

    console.log('\n========================================');
    console.log(' FULL REGRESSION RESULTS');
    console.log('========================================');
    console.log('Passed: ' + grandPassed);
    console.log('Failed: ' + grandFailed);
    if (failures.length) {
        console.log('\nFailures by suite:');
        for (const suite of failures) {
            console.log('  ' + suite.suite);
            for (const failure of suite.failures) {
                console.log('    - ' + failure.name + ': ' + failure.error);
            }
        }
    }
    process.exit(grandFailed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
