/**
 * Next.js server instance'i boshlanganda bir marta ishlaydi.
 * Node.js'ga xos sozlamalar alohida faylda — Edge runtime ularni yuklamasin.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
