const { seed, seedTickets } = require('./seed');
console.log(seed() ? 'Seeded authors, books and users.' : 'Already seeded.');
seedTickets();
