// Prověrka nemovitosti – krok 1: identifikace z adresy nebo odkazu na inzerát.
// Adresy a budovy z veřejných služeb RÚIAN (ČÚZK); inzeráty čte malý skript na Cloudflaru (worker/inzerat.js).
const WORKER_URL = new URLSearchParams(location.search).get("worker")  // pro testování
  || "";  // např. https://proverka-inzerat.<účet>.workers.dev – doplní se po nasazení
const RUIAN = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN";
const GEOKODER = `${RUIAN}/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer/exts/GeocodeSOE/findAddressCandidates`;
const PROHLIZECI = `${RUIAN}/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer`;
const PORTALY = ["sreality.cz", "bezrealitky.cz", "reality.idnes.cz"];

const ZPUSOB_VYUZITI = {
  1: "průmyslový objekt", 2: "zemědělská usedlost", 3: "objekt k bydlení", 4: "objekt lesního hospodářství",
  5: "objekt občanské vybavenosti", 6: "bytový dům", 7: "rodinný dům", 8: "stavba pro rodinnou rekreaci",
  10: "stavba pro obchod", 11: "stavba ubytovacího zařízení", 12: "stavba pro výrobu a skladování",
  14: "stavba pro administrativu", 18: "garáž", 19: "jiná stavba", 20: "víceúčelová stavba",
};
const KONSTRUKCE = {
  1: "cihly, tvárnice", 2: "kámen", 3: "kámen a cihly", 4: "stěnové panely", 6: "dřevo",
  7: "jiné materiály", 10: "kámen, cihly, tvárnice", 11: "monolit", 41: "panely (beton)",
};
const VYTAH = { 1: "s výtahem", 2: "bez výtahu" };
const TYP_INZERATU = { byt: "byt", dum: "rodinný dům", pozemek: "pozemek" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nacitam = (text) => { $("vysledek").innerHTML = `<p class="tlumene">${esc(text)}</p>`; };

async function dotaz(url, params) {
  const r = await fetch(`${url}?${new URLSearchParams({ f: "json", ...params })}`);
  if (!r.ok) throw new Error(`Služba ČÚZK odpověděla ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Chyba služby ČÚZK");
  return data;
}

// ---------- RÚIAN ----------

async function geokoduj(text, pocet = 10) {
  const data = await dotaz(GEOKODER, { SingleLine: text, outSR: 4326, maxLocations: pocet });
  return (data.candidates || []).filter((c) => c.score >= 90);
}

async function adresniMista(where) {
  const d = await dotaz(`${PROHLIZECI}/1/query`, { where, outFields: "kod,adresa,stavebniobjekt", returnGeometry: true, outSR: 4326 });
  return (d.features || []).map((f) => ({ kod: f.attributes.kod, adresa: f.attributes.adresa, so: f.attributes.stavebniobjekt,
    lat: f.geometry?.y, lon: f.geometry?.x }));
}

async function adresyUBodu(lat, lon, metru) {
  const d = await dotaz(`${PROHLIZECI}/1/query`, {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint",
    inSR: 4326, spatialRel: "esriSpatialRelIntersects", distance: metru, units: "esriSRUnit_Meter",
    outFields: "kod,adresa,stavebniobjekt", returnGeometry: true, outSR: 4326,
  });
  return (d.features || []).map((f) => ({ kod: f.attributes.kod, adresa: f.attributes.adresa, so: f.attributes.stavebniobjekt,
    lat: f.geometry.y, lon: f.geometry.x, vzdalenost: vzdalenost(lat, lon, f.geometry.y, f.geometry.x) }));
}

async function budovy(kody) {
  const unikatni = [...new Set(kody)].filter(Boolean);
  if (!unikatni.length) return {};
  const d = await dotaz(`${PROHLIZECI}/3/query`, { where: `kod in (${unikatni.join(",")})`, outFields: "*", returnGeometry: false });
  return Object.fromEntries((d.features || []).map((f) => [f.attributes.kod, f.attributes]));
}

async function mestskaCast(kod) {
  if (!kod) return null;
  const m = await dotaz(`${PROHLIZECI}/8/query`, { where: `kod=${kod}`, outFields: "nazev", returnGeometry: false });
  return m.features?.[0]?.attributes?.nazev || null;
}

function vzdalenost(lat1, lon1, lat2, lon2) {
  const r = 6371000, k = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * k / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin((lon2 - lon1) * k / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

function typBudovy(b) {
  const zpusob = ZPUSOB_VYUZITI[b.zpusobvyuzitikod] || "jiný";
  if (b.zpusobvyuzitikod === 6 || (b.pocetbytu || 0) > 3) return { typ: "bytový dům", zpusob };
  if ([2, 3, 7, 8].includes(b.zpusobvyuzitikod)) return { typ: "rodinný dům", zpusob };
  return { typ: "jiná stavba", zpusob };
}

// Odpovídá budova inzerátu? Typ (byt ↔ bytový dům, dům ↔ rodinný dům) a počet podlaží.
function shodaSInzeratem(b, inz) {
  if (!inz) return 0;
  let body = 0;
  const { typ } = typBudovy(b);
  if (inz.typ === "byt") body += typ === "bytový dům" ? 2 : -3;
  if (inz.typ === "dum") body += typ === "rodinný dům" ? 2 : -3;
  if (inz.podlazi_budovy && b.pocetpodlazi) body += Math.abs(inz.podlazi_budovy - b.pocetpodlazi) <= 0 ? 2 : -1;
  return body;
}

const bezDiakritiky = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const naUlici = (adresa, ulice) => !ulice || bezDiakritiky(adresa).startsWith(bezDiakritiky(ulice) + " ");

// ---------- Identifikace z inzerátu ----------

async function nactiInzerat(url) {
  if (!WORKER_URL) return null;
  const r = await fetch(`${WORKER_URL}?url=${encodeURIComponent(url)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.chyba) throw new Error(data.chyba || `Inzerát se nepodařilo načíst (${r.status})`);
  return data;
}

// Vrací { adresa, jak, jistota } nebo { kandidati, duvod }.
async function najdiBudovuZInzeratu(inz) {
  // 1) Bezrealitky: přímo kód adresního místa v RÚIAN.
  if (inz.ruian_adresa) {
    const [a] = await adresniMista(`kod=${parseInt(inz.ruian_adresa, 10)}`);
    if (a) return { adresa: a, jak: "kód adresy v RÚIAN uvedený v inzerátu", jistota: "jistá" };
  }
  // 2) Sreality: ulice s číslem popisným a orientačním.
  if (inz.ulice && inz.cislo_popisne) {
    const cislo = inz.cislo_orientacni ? `${inz.cislo_popisne}/${inz.cislo_orientacni}` : inz.cislo_popisne;
    const kand = await geokoduj(`${inz.ulice} ${cislo}, ${inz.cast_obce || inz.obec || ""}`, 5);
    const presna = kand.find((c) => c.attributes.Type === "AdresniMisto" && c.address.includes(` ${cislo},`));
    if (presna) {
      const [a] = await adresyUBodu(presna.location.y, presna.location.x, 2);
      if (a && (inz.presnost === "adresa" || inz.presnost === "gps")) {
        return { adresa: a, jak: inz.presnost === "adresa" ? "adresa zadaná v inzerátu" : "adresa podle bodu na mapě v inzerátu",
          jistota: inz.presnost === "adresa" ? "jistá" : "vysoká" };
      }
      if (a && !inz.lat) return { adresa: a, jak: "adresa v inzerátu (přesnost neuvedena)", jistota: "střední" };
    }
  }
  // 3) Bod na mapě + ulice: adresy do 80 m, seskupené podle budov a seřazené podle shody s inzerátem.
  if (inz.lat && inz.lon) {
    const okoli = (await adresyUBodu(inz.lat, inz.lon, 80)).filter((a) => naUlici(a.adresa, inz.ulice));
    const vybrane = await vyberBudovu(okoli, inz, (a) => a.vzdalenost);
    if (vybrane.jedna) return { adresa: vybrane.jedna, jak: "jediná odpovídající budova u bodu na mapě v inzerátu", jistota: "vysoká" };
    if (vybrane.kandidati.length) return { kandidati: vybrane.kandidati, duvod: "Inzerát uvádí jen přibližné místo. Nejblíž bodu na mapě jsou tyto domy:" };
  }
  // 4) Jen ulice a část obce (iDNES): budovy v ulici, které sedí typem a počtem podlaží.
  if (inz.ulice) {
    const kand = await geokoduj(`${inz.ulice}, ${inz.cast_obce || inz.mestska_cast || inz.obec || ""}`, 50);
    const adresy = kand.filter((c) => c.attributes.Type === "AdresniMisto" && naUlici(c.address, inz.ulice))
      .map((c) => ({ adresa: c.address, lat: c.location.y, lon: c.location.x }));
    const sKody = await Promise.all(adresy.slice(0, 40).map(async (a) => (await adresyUBodu(a.lat, a.lon, 1))[0]).map((p) => p.catch(() => null)));
    const vybrane = await vyberBudovu(sKody.filter(Boolean), inz, () => 0);
    if (vybrane.jedna) return { adresa: vybrane.jedna, jak: "jediná budova v ulici, která sedí typem a počtem podlaží", jistota: "střední" };
    if (vybrane.kandidati.length) return { kandidati: vybrane.kandidati, duvod: `Inzerát neuvádí číslo domu. V ulici ${inz.ulice} odpovídají tyto domy:` };
  }
  return { kandidati: [], duvod: "Z inzerátu se nepodařilo určit dům." };
}

async function vyberBudovu(adresy, inz, klicRazeni) {
  if (!adresy.length) return { kandidati: [] };
  const b = await budovy(adresy.map((a) => a.so));
  const podleBudovy = new Map();
  for (const a of adresy.sort((x, y) => klicRazeni(x) - klicRazeni(y))) {
    if (!b[a.so] || podleBudovy.has(a.so)) continue;
    podleBudovy.set(a.so, { ...a, skore: shodaSInzeratem(b[a.so], inz) });
  }
  const vsechny = [...podleBudovy.values()];
  const nejlepsi = Math.max(...vsechny.map((x) => x.skore));
  const top = vsechny.filter((x) => x.skore === nejlepsi);
  if (top.length === 1 && nejlepsi > 0) return { jedna: top[0], kandidati: [] };
  return { kandidati: top.slice(0, 6) };
}

// ---------- Zobrazení ----------

function karta(trida, nadpis, obsah) {
  return `<div class="karta ${trida}"><h2>${esc(nadpis)}</h2>${obsah}</div>`;
}

function nabidni(kandidati, nadpis, uvod, inz) {
  const seznam = kandidati.map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.adresa)}${
    c.vzdalenost != null ? ` <span class="tlumene">(${c.vzdalenost} m od bodu v inzerátu)</span>` : ""}</button></li>`).join("");
  $("vysledek").innerHTML = karta("upresnit", nadpis, `<p>${uvod}</p><ul class="kandidati">${seznam}</ul>
    <p class="tlumene">Nebo zadejte přesnou adresu do pole nahoře.</p>`);
  $("vysledek").querySelectorAll("button[data-i]").forEach((btn) => btn.addEventListener("click", () =>
    zobrazBudovu(kandidati[+btn.dataset.i], inz, { jak: "vybráno z nabídky", jistota: "jistá" }).catch(chyba)));
}

async function zobrazBudovu(adresa, inz, puvod) {
  nacitam("Načítám údaje o budově…");
  const b = (await budovy([adresa.so]))[adresa.so];
  if (!b) throw new Error("Budovu k adrese se v RÚIAN nepodařilo načíst");
  const mc = await mestskaCast(b.momc);
  const { typ, zpusob } = typBudovy(b);

  const upozorneni = [];
  if (!/Praha/.test(adresa.adresa)) upozorneni.push("Zatím prověřujeme jen Prahu. Identifikace funguje, další kroky pro tuto obec zatím nejsou.");
  if (inz?.typ === "byt" && typ === "rodinný dům") upozorneni.push("Inzerát nabízí byt, ale na adrese je podle RÚIAN rodinný dům. Ověřte prosím adresu.");
  if (inz?.typ === "dum" && typ === "bytový dům") upozorneni.push("Inzerát nabízí rodinný dům, ale na adrese je podle RÚIAN bytový dům. Ověřte prosím adresu.");
  if (inz?.podlazi_budovy && b.pocetpodlazi && inz.podlazi_budovy !== b.pocetpodlazi)
    upozorneni.push(`Inzerát uvádí dům o ${inz.podlazi_budovy} podlažích, RÚIAN ${b.pocetpodlazi}. Drobný rozdíl bývá (počítání suterénu), větší je důvod adresu ověřit.`);
  if (typ === "jiná stavba") upozorneni.push(`Budova je v RÚIAN vedená jako „${zpusob}“. Prověrka zatím umí byty a rodinné domy.`);

  const rok = b.dokonceni ? new Date(b.dokonceni).getFullYear() : null;
  const radky = [
    ["Adresa", adresa.adresa],
    ["Městská část", mc || "–"],
    ["Typ", typ === zpusob ? typ : `${typ} (v RÚIAN: ${zpusob})`],
    ["Čísla popisná budovy", b.cisladomovni],
    ["Bytů v budově", b.pocetbytu ?? "–"],
    ["Podlaží", b.pocetpodlazi ?? "–"],
    ["Konstrukce", KONSTRUKCE[b.druhkonstrukcekod] || "–"],
    ["Výtah", VYTAH[b.vybavenivytahemkod] || "–"],
    ["Zastavěná plocha", b.zastavenaplocha ? `${b.zastavenaplocha} m²` : "–"],
    ["Dokončení (evidence)", rok && rok !== 1945 ? rok : "neuvedeno"],
  ];
  if (inz) {
    const popis = [TYP_INZERATU[inz.typ] || inz.typ, inz.dispozice, inz.plocha_m2 && `${inz.plocha_m2} m²`,
      inz.patro != null && `${inz.patro}. NP`, inz.cena_kc && `${inz.cena_kc.toLocaleString("cs-CZ")} Kč`].filter(Boolean).join(", ");
    radky.push(["Inzerát", `${popis} (${inz.portal})`]);
  }
  radky.push(["Jak jsme dům určili", `${puvod.jak}; jistota ${puvod.jistota}`]);

  const byt = typ === "bytový dům";
  const dalsi = typ === "jiná stavba" ? "" : byt
    ? `<p class="tlumene">Číslo bytové jednotky od vás nepotřebujeme: dům stačí pro rozbor povodní, hluku, územního plánu, SVJ a ceny.
       Jednotku dohledáme v katastru podle plochy a podlaží z inzerátu.</p>`
    : "";
  const tabulka = `<dl>${radky.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const nadpis = typ === "jiná stavba" ? "Tento typ stavby zatím neprověřujeme" : "Nemovitost je identifikovaná";
  $("vysledek").innerHTML = karta(typ === "jiná stavba" ? "upresnit" : "ok", nadpis,
    tabulka + upozorneni.map((u) => `<p class="poznamka">${esc(u)}</p>`).join("") + dalsi +
    `<p class="tlumene">Další krok (rozbor katastru, povodní, hluku, územního plánu a ceny) zatím není zapojen.</p>`);
}

function chyba(err) {
  $("vysledek").innerHTML = karta("chyba", "Něco se nepovedlo", `<p>${esc(err.message)}. Zkuste to prosím znovu, případně zadejte adresu.</p>`);
}

// Odkaz na portál bez skriptu na Cloudflaru: aspoň ulice z adresy odkazu (Sreality).
function lokalitaZOdkazu(u) {
  const cesta = decodeURIComponent(u.pathname).split("/").filter(Boolean);
  if (u.hostname.endsWith("sreality.cz") && cesta[0] === "detail")
    return { typ: cesta[2], dispozice: cesta[3] !== "rodinny" ? cesta[3] : null, lokalita: (cesta[4] || "").replace(/-/g, " ") };
  if (u.hostname.endsWith("idnes.cz") && cesta[0] === "detail")  // /detail/prodej/byt/praha-6-lindleyova/<id>/
    return { typ: cesta[2], dispozice: null, lokalita: (cesta[3] || "").replace(/-/g, " ") };
  return null;
}

async function overit(e) {
  e.preventDefault();
  const tlacitko = document.querySelector("button[type=submit]");
  tlacitko.disabled = true;
  try {
    const text = $("vstup").value.trim();
    let url = null;
    try { url = new URL(text); } catch { /* adresa */ }

    if (url) {
      if (!PORTALY.some((p) => url.hostname.replace(/^www\./, "").endsWith(p))) {
        $("vysledek").innerHTML = karta("upresnit", "Tento portál zatím neumíme přečíst",
          `<p>Umíme Sreality, Bezrealitky a iDNES Reality. Zadejte prosím adresu nemovitosti.</p>`);
        return;
      }
      nacitam("Čtu inzerát…");
      const inz = await nactiInzerat(url.href).catch((err) => { console.warn(err); return null; });
      if (inz) {
        nacitam("Hledám dům v registru adres…");
        const v = await najdiBudovuZInzeratu(inz);
        if (v.adresa) return await zobrazBudovu(v.adresa, inz, v);
        if (v.kandidati.length) return nabidni(v.kandidati, "Vyberte dům z inzerátu", esc(v.duvod), inz);
      }
      // Záloha: jen ulice z adresy odkazu.
      const lok = lokalitaZOdkazu(url);
      if (lok?.lokalita) {
        const kand = (await geokoduj(lok.lokalita, 10)).filter((c) => c.attributes.Type === "AdresniMisto");
        const adresy = await Promise.all(kand.slice(0, 8).map(async (c) => (await adresyUBodu(c.location.y, c.location.x, 1))[0]));
        adresy.forEach((a) => { if (a) a.vzdalenost = null; });
        return nabidni(adresy.filter(Boolean), "Vyberte dům z inzerátu",
          `Tento portál nepovoluje automatické čtení inzerátu, z odkazu známe jen ulici. Vyberte dům, nebo zadejte adresu.`, { typ: lok.typ, dispozice: lok.dispozice, portal: url.hostname });
      }
      $("vysledek").innerHTML = karta("upresnit", "Z odkazu nejde vyčíst adresu", `<p>Zadejte prosím adresu nemovitosti.</p>`);
      return;
    }

    nacitam("Hledám v registru adres…");
    const kand = await geokoduj(text, 10);
    const adresy = kand.filter((c) => c.attributes.Type === "AdresniMisto");
    if (!kand.length) {
      $("vysledek").innerHTML = karta("chyba", "Adresu se nepodařilo najít",
        `<p>V registru adres RÚIAN jsme nic nenašli. Zkontrolujte ulici a číslo, případně přidejte část obce.</p>`);
    } else if (adresy.length === 1) {
      const [a] = await adresyUBodu(adresy[0].location.y, adresy[0].location.x, 1);
      await zobrazBudovu(a, null, { jak: "adresa zadaná uživatelem", jistota: "jistá" });
    } else {
      const seznam = (await Promise.all(adresy.slice(0, 8).map(async (c) => (await adresyUBodu(c.location.y, c.location.x, 1))[0]))).filter(Boolean);
      seznam.forEach((a) => { a.vzdalenost = null; });
      nabidni(seznam, "Upřesněte adresu",
        seznam.length ? `Zadání odpovídá více adresám. Vyberte správnou, nebo doplňte číslo či část obce.`
                      : `Našli jsme jen ulici, ne konkrétní dům. Doplňte číslo popisné nebo orientační.`, null);
    }
  } catch (err) {
    chyba(err);
  } finally {
    tlacitko.disabled = false;
  }
}

// ---------- Našeptávač adres ----------

let casovac;
$("vstup").addEventListener("input", () => {
  clearTimeout(casovac);
  const text = $("vstup").value.trim();
  if (text.length < 4 || /^https?:\/\//i.test(text)) return;
  casovac = setTimeout(async () => {
    try {
      const kand = (await geokoduj(text, 8)).filter((c) => c.attributes.Type === "AdresniMisto");
      $("navrhy").innerHTML = kand.map((c) => `<option value="${esc(c.address)}"></option>`).join("");
    } catch { /* našeptávač je jen pomůcka */ }
  }, 300);
});

$("formular").addEventListener("submit", overit);
