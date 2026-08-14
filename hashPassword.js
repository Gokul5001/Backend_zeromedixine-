const bcrypt = require("bcrypt");

async function hashPassword(plainPassword) {
  const SALT_ROUNDS = 10; // recommended: 10–12
  const hashed = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  return hashed;
}

// 🔽 change password here
const password = "clinicphysio@zeromed";

hashPassword(password)
  .then(hash => {
    console.log("Plain Password:", password);
    console.log("Hashed Password:", hash);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
