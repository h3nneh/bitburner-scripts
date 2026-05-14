// Source: https://github.com/66Ton99/bitburner-scripts/blob/main/corporation-options.js
export const argsSchema = [
    ['corporation-name', 'Turing Complete'], // Corporation name, if we have to create a new one.
    ['no-expansion', false], // If this flag is set, do not expand to new industries. Just work on what we have.
    ['reserve-amount', 1e9], // Don't spend the corporation's last $billion if we can help it.
    ['verbose', false], // Print extra log messages.
    ['can-accept-funding', true], // When we run low on money, should we look for outside funding?
    ['can-go-public', true], // If we can't get private funding, should we go public?
    ['issue-shares', 0], // If we go public, how many shares should we issue?
    ['can-spend-hashes', true], // Can we spend hacknet hashes (assuming we have them)?
    ['once', false], // Run once, then quit, instead of going into a loop.
    ['mock', false], // Run the task assignment queue, but don't actually spend any money.
    ['price-discovery-only', false], // Don't do any auto-buying, just try to keep the sale price balanced as high as possible. (Emulating TA2 as best we can)
    ['first', 'Agriculture'], // What should we use for our first division? Agriculture works well, but others should be fine too.
    ['second', 'Real Estate'], // What should we prefer for our second division? If we can't afford it, we'll buy what we can afford instead.
    ['no-tail-windows', false], // Suppress tail windows when launched by daemon.js default no-tail orchestration.
];
