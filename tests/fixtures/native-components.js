// A different design from CasinoFX: explicitly annotated interactive components.
// No navigation URLs, field actions or timing values are invented by the compiler.
const text = (id, content, extra = {}) => ({ type: "text-basic", id, text: content, ...extra });
const block = (id, children, extra = {}) => ({ type: "block", id, children, ...extra });
const section = (id, children) => ({ type: "section", id, children });
const component = (kind, options = {}, role) => ({ kind, ...(role ? { role } : {}), ...(Object.keys(options).length ? { options } : {}) });

export function nativeFixture() {
  return { type: "page", children: [
    section("shop-header", [block("main-navigation", [
      text("nav-shop", "Shop", { href: "https://example.com/shop" }),
      block("catalog-dropdown", [text("catalog-title", "Catalog"), block("catalog-menu", [text("catalog-tools", "Tools", { href: "https://example.com/tools" }), text("catalog-kits", "Kits", { href: "https://example.com/kits" })])], { component: component("navigation", {}, "dropdown") }),
      text("nav-contact", "Contact", { href: "https://example.com/contact" })
    ], { component: component("navigation", { mobileBreakpoint: "mobile_landscape", gap: 24, ariaLabel: "Main navigation" }), layout: { display: "flex", direction: "row" } })]),
    section("featured-products", [block("featured-carousel", [
      block("product-slide-a", [text("product-title-a", "Toolkit")], { size: { width: 300 } }),
      block("product-slide-b", [text("product-title-b", "Workshop kit")], { size: { width: 300 } }),
      block("product-slide-c", [text("product-title-c", "Refill")], { size: { width: 300 } })
    ], { component: component("slider", { slidesPerView: 3, gap: 20, arrows: true, pagination: true, loop: true, speed: 400, responsive: { tablet_portrait: { slidesPerView: 2 }, mobile_portrait: { slidesPerView: 1 } } }), layout: { display: "flex", direction: "row" } })]),
    section("product-details", [block("details-tabs", [
      block("details-tab-menu", [text("specs-tab", "Specifications"), text("delivery-tab", "Delivery")], { component: component("tabs", {}, "tab-menu"), layout: { display: "flex", direction: "row", gap: 20 } }),
      block("details-tab-content", [block("specs-panel", [text("specs-copy", "Stainless steel tools")]), block("delivery-panel", [text("delivery-copy", "Ships in two days")])], { component: component("tabs", {}, "tab-content") })
    ], { component: component("tabs", { openIndex: 0 }) })]),
    section("support", [block("support-accordion", [
      block("support-item-a", [block("support-title-a", [text("support-question-a", "How do I replace a part?")], { component: component("accordion", {}, "accordion-title") }), block("support-content-a", [text("support-answer-a", "Use the refill catalog.")], { component: component("accordion", {}, "accordion-content") })]),
      block("support-item-b", [block("support-title-b", [text("support-question-b", "Can I return it?")], { component: component("accordion", {}, "accordion-title") }), block("support-content-b", [text("support-answer-b", "Contact the shop.")], { component: component("accordion", {}, "accordion-content") })])
    ], { component: component("accordion", { openIndex: 0, independentToggle: true, transition: 200 }) })]),
    section("inquiry", [block("inquiry-form", [], { component: component("form", { submitText: "Send inquiry", fields: [{ id: "customer-name", type: "text", label: "Name", required: true }, { id: "customer-email", type: "email", label: "Email", required: true }, { id: "customer-message", type: "textarea", label: "Message" }] }) })]),
    section("static-features", [block("feature-cards", [block("feature-one", [text("feature-one-copy", "Durable")], { size: { width: 300 } }), block("feature-two", [text("feature-two-copy", "Repairable")], { size: { width: 300 } }), block("feature-three", [text("feature-three-copy", "Reusable")], { size: { width: 300 } })], { type: "row", layout: { display: "flex", direction: "row", gap: 20 } })])
  ] };
}
