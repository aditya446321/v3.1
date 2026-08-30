# Video Selling v3.1

Production-oriented Node.js + PostgreSQL storefront with a server-generated dynamic UPI QR and authenticated admin panel.

## Important
- `schema.sql` is a complete, repeatable Supabase PostgreSQL schema. The seed statements avoid the earlier `VALUES`/`SELECT *` syntax problem.
- The server also creates the core tables on startup for hosts that do not run migrations, but running `schema.sql` first is recommended.
- Set `UPI_ID` to the real UPI ID you control.
- Never request or store UPI PINs, OTPs, banking passwords, or card PINs.
- `ADMIN_PASSWORD_HASH` must be a bcrypt hash; never commit a raw PIN.
- Do not commit `.env`.

## Local
1. `npm install`
2. Copy `.env.example` to `.env`
3. Fill `DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `UPI_ID`
4. `npm start`
5. Open `/` and `/admin`

## Dynamic QR
`GET /api/qr/:id` reads the current package and active offer from PostgreSQL and generates a fresh UPI QR. Changing a package price or active offer changes the checkout amount and QR without uploading a new PNG.

## Discount example
Original price ₹2,000 and sale price ₹499 automatically display `75% OFF`.

## Deployment
Use any Node.js host that supports environment variables and a persistent web process (for example Render) and a managed PostgreSQL database (for example Supabase). Set the same environment variables in the host dashboard.
