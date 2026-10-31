// ARCHIV – záložka „Prověřit“ (bookmarklet), vyřazená 31. 10. 2026. Do stránky se nenačítá.
// Jak ji vrátit: viz README.md v této složce.

// ---------- Záložka „Prověřit“ ----------
// Běží na stránce inzerátu v prohlížeči uživatele (ne na našem serveru): přečte otevřený inzerát
// a otevře tuto stránku s údaji v části adresy za # (ta se na server neposílá).

function zalozka() {
  const CIL = "https://proverka.gratzer.cz/";
  const host = location.hostname.replace(/^www\./, "");
  const cislo = (s) => { const m = String(s ?? "").replace(/\s/g, "").match(/\d+/); return m ? +m[0] : null; };
  const nextData = (html) => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]) : null; };
  const posli = (d) => { location.href = CIL + "#inzerat=" + encodeURIComponent(JSON.stringify({ ...d, portal: host, url: location.origin + location.pathname })); };
  (async () => {
    if (host.endsWith("sreality.cz")) {
      const id = location.pathname.match(/(\d+)\/?$/)?.[1];
      const najdi = (n) => n?.props?.pageProps?.dehydratedState?.queries
        ?.find((q) => q.queryKey?.[0] === "estate" && String(q.state?.data?.id) === id)?.state?.data;
      // Po proklikání z výsledků hledání je v __NEXT_DATA__ jiná stránka; pak ji načteme znovu (jako obnovení stránky).
      let d = najdi(nextData(document.documentElement.innerHTML));
      if (!d) d = najdi(nextData(await (await fetch(location.href)).text()));
      if (!d) return alert("Prověřit: otevřete prosím detail inzerátu.");
      const l = d.locality || {}, p = d.params || {};
      return posli({
        typ: { Byty: "byt", Domy: "dum", Pozemky: "pozemek" }[d.categoryMainCb?.name] || null, dispozice: d.categoryMainCb?.name === "Byty" ? d.categorySubCb?.name || null : null,
        nazev: d.name, ulice: l.street || null, cislo_popisne: l.houseNumber || null, cislo_orientacni: l.streetNumber || null,
        presnost: { address: "adresa", gps: "gps", street: "ulice" }[l.inaccuracyType] || l.inaccuracyType || null,
        lat: l.latitude ?? null, lon: l.longitude ?? null, obec: l.city || null, cast_obce: l.cityPart || l.ward || null,
        patro: p.floorNumber ?? null, podlazi_budovy: p.floors ?? null, plocha_m2: p.usableArea ?? p.floorArea ?? null,
        pozemek_m2: p.estateArea ?? cislo(d.name?.match(/pozemek\s+([\d\s]+)/)?.[1]), cena_kc: d.priceCzk ?? null,
      });
    }
    if (host.endsWith("bezrealitky.cz")) {
      const props = nextData(document.documentElement.innerHTML)?.props?.pageProps || {};
      const a = props.origAdvert || Object.entries(props.apolloCache || {}).find(([k]) => k.startsWith("Advert:"))?.[1];
      if (!a) return alert("Prověřit: otevřete prosím detail inzerátu.");
      return posli({
        typ: { BYT: "byt", DUM: "dum", POZEMEK: "pozemek" }[a.estateType] || null, nazev: a.imageAltText || null,
        ulice: a.street || null, cislo_popisne: a.houseNumber || null, ruian_adresa: a.ruianId || null,
        presnost: a.ruianId ? "ruian" : a.gps ? "gps" : "ulice", lat: a.gps?.lat ?? null, lon: a.gps?.lng ?? null, obec: a.city || null,
        patro: a.etage ?? null, podlazi_budovy: a.totalFloors ?? null, plocha_m2: a.surface ?? null, pozemek_m2: a.surfaceLand ?? null, cena_kc: a.price ?? null,
      });
    }
    if (host.endsWith("reality.idnes.cz")) {
      const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;
      const parametry = {};
      document.querySelectorAll("dt").forEach((dt) => { parametry[text(dt)] = text(dt.nextElementSibling); });
      const misto = text(document.querySelector(".b-detail__info")) || "";
      const [ulice, zbytek] = misto.includes(",") ? misto.split(/,\s*/, 2) : [null, misto];
      const [mc, cast] = (zbytek || "").split(/\s+-\s+/);
      const nazev = text(document.querySelector("h1"));
      return posli({
        typ: location.pathname.split("/")[3] || null, nazev, dispozice: nazev?.match(/\d\+(?:kk|\d)/)?.[0] || null,
        ulice, presnost: ulice ? "ulice" : "lokalita", obec: mc?.startsWith("Praha") ? "Praha" : mc || null, cast_obce: cast || null,
        patro: cislo(parametry["Podlaží"]?.match(/\((\d+)\.\s*NP\)/)?.[1] ?? parametry["Podlaží"]),
        podlazi_budovy: cislo(parametry["Počet podlaží budovy"]), plocha_m2: cislo(parametry["Užitná plocha"]),
        pozemek_m2: cislo(parametry["Plocha pozemku"]),
      });
    }
    alert("Prověřit umí inzeráty ze Sreality, Bezrealitek a iDNES Reality.");
  })().catch((e) => alert("Prověřit: inzerát se nepodařilo přečíst (" + e.message + ")."));
}

const KOD_ZALOZKY = "javascript:" + encodeURIComponent(`(${zalozka.toString()})()`);
$("zalozka").href = KOD_ZALOZKY;
$("zalozka").addEventListener("click", (e) => { e.preventDefault(); alert("Tlačítko přetáhněte na lištu záložek. Klikněte na něj až na stránce inzerátu."); });
$("kopirovat").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(KOD_ZALOZKY); $("kopirovat").textContent = "Zkopírováno ✓"; }
  catch { prompt("Zkopírujte tento text:", KOD_ZALOZKY); }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(".otevri-navod")) return;
  e.preventDefault();
  $("zalozka-info").open = true;
  $("zalozka-info").scrollIntoView({ behavior: "smooth" });
});


// Příjem údajů na stránce prověrky (patří na konec app.js; zpracujInzerat je v app.js).
// Údaje ze záložky „Prověřit“.
if (location.hash.startsWith("#inzerat=")) {
  try {
    const inz = JSON.parse(decodeURIComponent(location.hash.slice(9)));
    history.replaceState(null, "", location.pathname + location.search);
    $("vstup").value = inz.url || "";
    zpracujInzerat(inz).catch(chyba);
  } catch (err) { chyba(new Error("Údaje ze záložky se nepodařilo přečíst")); }
}
