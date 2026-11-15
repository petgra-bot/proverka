// Předváděcí průchod objednávky (jen na testu, Petr 13. 11. 2026).
// Nahrazuje server objednávek přímo v prohlížeči: nic se neplatí ani neodesílá, průběh je zrychlený
// a končí vzorovým reportem ke Karlické 910/49 (test 7 ze 4. 11. 2026, bez osobních údajů).
// Zapíná ho objednavka/nastaveni.js parametrem ?predvedeni=1.
(() => {
  const KLIC = "predkoupi-predvedeni";
  const ADRESA = "Karlická 910/49, Radotín, 15300 Praha 5";
  const TRVANI_S = { proverka: 70, plus: 100 };           // skutečně do 5 a do 10 minut
  // Stejné kroky a váhy jako server a stav.js (14. 11. 2026: samostatný krok Odhad ceny, v Prověrce zamčený).
  const FAZE = [["platba", "Platba", 2], ["katastr", "Katastr a identifikace", 15], ["fakta", "Povodně, hluk, radon a územní plán", 20],
    ["pravni", "Právní stav a záměry v okolí", 20], ["cena", "Odhad ceny z prodejů v katastru", 10], ["report", "Report", 20], ["kontrola", "Kontrola kvality", 13]];
  const NAZEV = { proverka: "Prověrka", plus: "Prověrka PLUS" };
  const CENA = { proverka: 790, plus: 1390 };
  const nacti = () => { try { return JSON.parse(sessionStorage.getItem(KLIC) || "{}"); } catch { return {}; } };
  const uloz = (s) => { try { sessionStorage.setItem(KLIC, JSON.stringify(s)); } catch { /* jde i bez */ } };
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
  const mil = (kc) => `${(kc / 1e6).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} mil. Kč`;
  const puvodni = window.fetch.bind(window);

  // Cena v PLUS: skutečný odhad z katastru pro tento dům proti ceně, kterou zadal návštěvník ukázky.
  function cena(k, zadana) {
    const kn = k.cena_kn; delete k.cena_kn;
    if (!kn || !zadana) return k;
    const rozdil = Math.round((zadana / kn.median - 1) * 100);
    const barva = zadana > kn.do ? "cervena" : rozdil > 5 ? "oranzova" : "zelena";
    k.cena = { barva, popisek: "Požadovaná cena", pozadovana: `${zadana.toLocaleString("cs-CZ")} Kč`,
      trh: `${mil(kn.od)} – ${mil(kn.do)} (medián ${mil(kn.median)})`, odchylka: `${rozdil > 0 ? "+" : ""}${rozdil} % proti mediánu`,
      text: `Odhad z ${kn.prodeju} skutečných prodejů podobných domů v okolí za poslední 3 roky (katastr). ` +
        (barva === "cervena" ? "Cena je nad horní hranicí odhadu – vyjednávejte. " : barva === "oranzova" ? "Cena je nad mediánem – je prostor k vyjednávání. " : "Cena odpovídá trhu. ") +
        "Argument ke slevě: doživotní břemeno a hluk z trati." };
    const s = (k.semafor || []).find((x) => x.oblast === "Cena");
    if (s) { s.barva = barva; s.text = `Požadovaná cena ${rozdil > 0 ? "+" : ""}${rozdil} % proti mediánu prodejů v okolí (${mil(kn.median)}).`; }
    return k;
  }

  window.fetch = async (url, opt = {}) => {
    const u = typeof url === "string" ? url : url.url;
    if (!u.startsWith("/predvedeni/objednavka")) return puvodni(url, opt);
    await new Promise((r) => setTimeout(r, 250));
    if (u === "/predvedeni/objednavka" && (opt.method || "").toUpperCase() === "POST") {
      const d = JSON.parse(opt.body || "{}");
      const bal = d.balicek === "plus" ? "plus" : "proverka";
      uloz({ balicek: bal, cena: d.cena || null, start: null });
      return json({ presmerovani: `/objednavka/?t=ukazka-${bal}&predvedeni=1` });
    }
    const m = u.match(/^\/predvedeni\/objednavka\/ukazka-(proverka|plus)(\/report\.json)?$/);
    if (!m) return json({ detail: "Objednávka nenalezena." }, 404);
    const bal = m[1];
    let s = nacti();
    if (s.balicek !== bal) s = { balicek: bal, cena: null, start: null };
    if (m[2]) {
      const k = await (await puvodni(`/predvedeni/report-${bal}.json`)).json();
      return json(cena(k, s.cena));
    }
    if (!s.start) { s.start = Date.now(); uloz(s); }
    const t = (Date.now() - s.start) / 1000, podil = Math.min(1, t / TRVANI_S[bal]);
    const aktivni = FAZE.filter(([k]) => bal === "plus" || k !== "cena");
    const celkem = aktivni.reduce((a, f) => a + f[2], 0);
    let kum = 0;
    const faze = FAZE.map(([klic, nazev, v], i) => {
      if (klic === "cena" && bal !== "plus") return { klic, nazev, hotovo: false, zamceno: true };
      kum += v; return { klic, nazev, hotovo: i === 0 || podil >= kum / celkem };
    });
    const hotovo = podil >= 1;
    return json({
      cislo: "UKÁZKA", stav: hotovo ? "hotovo" : "bezi", balicek: NAZEV[bal], cena: CENA[bal], adresa: ADRESA, test: true, faze,
      dodani_min: 2, typ: "dum", bezi_s: Math.round(podil * 120), letecky: "/letecky.jpg",
      ...(hotovo ? { report: { data: `/objednavka/ukazka-${bal}/report.json`, pdf: bal === "plus" ? ["/proverka.pdf", "/podrobny.pdf"] : ["/proverka.pdf"] } } : {}),
    });
  };
})();
