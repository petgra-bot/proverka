// Prověrka nemovitosti – krok 1: identifikace z adresy nebo odkazu na inzerát.
// Adresy a budovy z veřejných služeb RÚIAN (ČÚZK); inzeráty čte malý skript na Cloudflaru (worker/inzerat.js).
const WORKER_URL = new URLSearchParams(location.search).get("worker")  // pro testování
  || "https://proverka-inzerat.p-gratzer.workers.dev/";
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
  // Počet podlaží v RÚIAN a v inzerátu se často liší (suterén, podkroví): shoda jen přidá, rozdíl neubírá.
  if (inz.podlazi_budovy && b.pocetpodlazi === inz.podlazi_budovy) body += 1;
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

// Stavební objekty, kterých se dotýká okolí bodu (špendlík v inzerátu).
async function budovyUBodu(lat, lon, metru) {
  const d = await dotaz(`${PROHLIZECI}/3/query`, {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint",
    inSR: 4326, spatialRel: "esriSpatialRelIntersects", distance: metru, units: "esriSRUnit_Meter", outFields: "kod", returnGeometry: false,
  });
  return (d.features || []).map((f) => f.attributes.kod);
}

async function adresyVUlici(ulice, obec, cast) {
  const sql = (s) => String(s).replace(/'/g, "''");
  const vse = await adresniMista(`adresa like '${sql(ulice)} %' and adresa like '%${sql(obec || "Praha")}%'`);
  const vCasti = cast ? vse.filter((a) => a.adresa.includes(`, ${cast},`)) : [];
  return (vCasti.length ? vCasti : vse).filter((a) => naUlici(a.adresa, ulice));
}

// Pozemek z inzerátu × katastr: sedí výměra stavební parcely domu, sama nebo s nejvýš dvěma sousedními parcelami
// (zahrada, dvůr)? Vrací pro každou budovu null (nesedí), 0 (jen stavební parcela), 1 (s parcelami se stejným
// kmenovým číslem nebo hned vedle) nebo 2 (se vzdálenějšími čísly). Ověřeno na 41 domech ze Sreality se známou adresou.
async function shodyPozemku(budovyPodleKodu, pozemek) {
  const parcelaBudovy = Object.fromEntries(Object.entries(budovyPodleKodu).map(([so, b]) => [b.identifikacniparcela, so]).filter(([p]) => p && p !== "null"));
  const ids = Object.keys(parcelaBudovy);
  if (!ids.length) return {};
  const vlastni = [];
  for (let i = 0; i < ids.length; i += 50)
    vlastni.push(...(await dotaz(`${PROHLIZECI}/5/query`, { where: `id in (${ids.slice(i, i + 50).join(",")})`,
      outFields: "id,vymeraparcely,kmenovecislo", returnGeometry: true })).features || []);
  const tolerance = Math.max(pozemek * 0.005, 2);
  const vysledek = {};
  await poJednom(vlastni, 6, async (f) => {
    const st = f.attributes;
    const params = new URLSearchParams({ f: "json", geometry: JSON.stringify(f.geometry), geometryType: "esriGeometryPolygon",
      inSR: 5514, spatialRel: "esriSpatialRelIntersects", outFields: "id,vymeraparcely,druhpozemkukod,kmenovecislo", returnGeometry: false });
    const r = await fetch(`${PROHLIZECI}/5/query`, { method: "POST", body: params });
    const sousede = ((await r.json()).features || []).map((x) => x.attributes)
      .filter((x) => x.id !== st.id && x.vymeraparcely <= pozemek && !(x.druhpozemkukod === 14 && x.vymeraparcely > 1000));  // ne silnice
    let nej = null;
    const zkus = (parcely) => {
      if (Math.abs(st.vymeraparcely + parcely.reduce((s, x) => s + x.vymeraparcely, 0) - pozemek) > tolerance) return;
      const daleko = parcely.some((x) => Math.abs(x.kmenovecislo - st.kmenovecislo) > 2);
      const kval = parcely.length === 0 ? 0 : daleko ? 2 : 1;
      nej = nej === null ? kval : Math.min(nej, kval);
    };
    zkus([]);
    sousede.forEach((a, i) => { zkus([a]); sousede.slice(i + 1).forEach((b) => zkus([a, b])); });
    vysledek[parcelaBudovy[st.id]] = nej;
  });
  return vysledek;
}

async function poJednom(polozky, soubezne, fn) {
  const fronta = [...polozky];
  await Promise.all(Array.from({ length: soubezne }, async () => {
    while (fronta.length) await fn(fronta.shift()).catch((e) => console.warn(e));
  }));
}

// Seřadí budovy u adres podle shody s inzerátem: typ a podlaží, špendlík na budově, výměra pozemku.
async function ohodnot(adresy, inz) {
  const kody = [...new Set(adresy.map((a) => a.so))].filter(Boolean);
  const b = {};
  for (let i = 0; i < kody.length; i += 100) Object.assign(b, await budovy(kody.slice(i, i + 100)));
  const naSpendliku = inz.lat && inz.presnost !== "ulice" ? new Set(await budovyUBodu(inz.lat, inz.lon, 5)) : new Set();
  const typSedi = Object.fromEntries(Object.entries(b).filter(([, x]) => shodaSInzeratem(x, inz) >= 0));
  const pozemky = inz.typ === "dum" && inz.pozemek_m2 && Object.keys(typSedi).length <= 80 ? await shodyPozemku(typSedi, inz.pozemek_m2) : {};

  const podleBudovy = new Map();
  for (const a of adresy) {
    if (!b[a.so] || podleBudovy.has(a.so)) continue;
    const duvody = [];
    let skore = shodaSInzeratem(b[a.so], inz);
    if (naSpendliku.has(a.so)) { skore += 3; duvody.push("bod na mapě v inzerátu leží na domě"); }
    if (pozemky[a.so] != null) {
      skore += pozemky[a.so] < 2 ? 3 : 2;
      duvody.push(`výměra pozemku ${inz.pozemek_m2} m² z inzerátu odpovídá parcelám domu v katastru`);
    }
    podleBudovy.set(a.so, { ...a, skore, duvody });
  }
  return [...podleBudovy.values()].sort((x, y) => y.skore - x.skore || (x.vzdalenost ?? 0) - (y.vzdalenost ?? 0));
}

// Vrací { adresa, jak, jistota, alternativy } nebo { kandidati, duvod }.
async function najdiBudovuZInzeratu(inz) {
  // 1) Bezrealitky: přímo kód adresního místa v RÚIAN.
  if (inz.ruian_adresa) {
    const [a] = await adresniMista(`kod=${parseInt(inz.ruian_adresa, 10)}`);
    if (a) return { adresa: a, jak: "kód adresy v RÚIAN uvedený v inzerátu", jistota: "jistá" };
  }
  // 2) Ulice s číslem popisným (Sreality u části inzerátů).
  if (inz.ulice && inz.cislo_popisne) {
    const cislo = inz.cislo_orientacni ? `${inz.cislo_popisne}/${inz.cislo_orientacni}` : inz.cislo_popisne;
    const kand = await geokoduj(`${inz.ulice} ${cislo}, ${inz.cast_obce || inz.obec || ""}`, 5);
    const presna = kand.find((c) => c.attributes.Type === "AdresniMisto" && c.address.includes(` ${cislo},`));
    if (presna) {
      const [a] = await adresyUBodu(presna.location.y, presna.location.x, 2);
      if (a) return { adresa: a, jak: "adresa uvedená v inzerátu", jistota: inz.presnost === "adresa" ? "jistá" : "vysoká" };
    }
  }
  // 3) Kandidáti: okolí bodu na mapě, nebo celá ulice, když inzerát uvádí jen ulici.
  let adresy = [];
  const presnyBod = inz.lat && inz.lon && inz.presnost !== "ulice";
  if (presnyBod) {
    const okoli = await adresyUBodu(inz.lat, inz.lon, 60);
    adresy = okoli.filter((a) => naUlici(a.adresa, inz.ulice));
    if (!adresy.length) adresy = okoli;
  } else if (inz.ulice) {
    adresy = await adresyVUlici(inz.ulice, inz.obec, inz.cast_obce);
    if (inz.lat) adresy.forEach((a) => { a.vzdalenost = vzdalenost(inz.lat, inz.lon, a.lat, a.lon); });
  } else if (inz.lat && inz.lon) {
    adresy = await adresyUBodu(inz.lat, inz.lon, 250);
  }
  if (!presnyBod) adresy.forEach((a) => { if (!inz.lat) a.vzdalenost = null; });
  if (!adresy.length) return { kandidati: [], duvod: "Z inzerátu se nepodařilo určit dům." };

  const poradi = await ohodnot(adresy, inz);
  const [prvni, druhy] = poradi;
  const nadDruhym = prvni.skore - (druhy ? druhy.skore : -99);
  const silny = prvni.duvody.length > 0;
  if (prvni.skore > 0 && nadDruhym >= 2 && (silny || poradi.length === 1)) {
    const jistota = prvni.duvody.length >= 2 || (prvni.duvody[0]?.startsWith("bod") && nadDruhym >= 3) ? "vysoká" : "střední";
    return { adresa: prvni, jistota, alternativy: jistota === "vysoká" ? [] : poradi.slice(1, 5).filter((x) => x.skore > 0),
      jak: prvni.duvody.length ? prvni.duvody.join("; ") : "jediná budova odpovídající typem" };
  }
  const nejlepsi = poradi.filter((x) => x.skore >= prvni.skore - 1 && x.skore > 0).slice(0, 6);
  const kandidati = nejlepsi.length ? nejlepsi : poradi.slice(0, 6);
  return { kandidati, duvod: presnyBod ? "Inzerát uvádí jen přibližné místo. Nejlépe odpovídají tyto domy:"
    : `Inzerát neuvádí číslo domu. ${inz.ulice ? `V ulici ${esc(inz.ulice)} ` : ""}nejlépe odpovídají tyto domy:` };
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
  const alternativy = puvod.alternativy || [];

  const byt = typ === "bytový dům";
  const dalsi = typ === "jiná stavba" ? "" : byt
    ? `<p class="tlumene">Číslo bytové jednotky od vás nepotřebujeme: dům stačí pro rozbor povodní, hluku, územního plánu, SVJ a ceny.
       Jednotku dohledáme v katastru podle plochy a podlaží z inzerátu.</p>`
    : "";
  const tabulka = `<dl>${radky.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const nadpis = typ === "jiná stavba" ? "Tento typ stavby zatím neprověřujeme" : "Nemovitost je identifikovaná";
  $("vysledek").innerHTML = karta(typ === "jiná stavba" ? "upresnit" : "ok", nadpis,
    tabulka + upozorneni.map((u) => `<p class="poznamka">${esc(u)}</p>`).join("") + dalsi +
    (alternativy.length ? `<div class="alternativy tlumene">Není to on? ${alternativy.map((a, i) =>
      `<button type="button" data-alt="${i}">${esc(a.adresa.split(",")[0])}</button>`).join("")}</div>` : "") +
    `<p class="tlumene">Další krok (rozbor katastru, povodní, hluku, územního plánu a ceny) zatím není zapojen.</p>`);
  $("vysledek").querySelectorAll("button[data-alt]").forEach((btn) => btn.addEventListener("click", () =>
    zobrazBudovu(alternativy[+btn.dataset.alt], inz, { jak: "vybráno z nabídky", jistota: "jistá" }).catch(chyba)));
}

function chyba(err) {
  $("vysledek").innerHTML = karta("chyba", "Něco se nepovedlo", `<p>${esc(err.message)}. Zkuste to prosím znovu, případně zadejte adresu.</p>`);
}

const TIP_ZALOZKA = `Dům určíme hned, když inzerát otevřete a klepnete na záložku <b>Prověřit</b>.
  <a href="#zalozka-info" class="otevri-navod">Jak si záložku přidat</a>.`;

// Odkaz na portál bez skriptu na Cloudflaru: aspoň typ a ulice z adresy odkazu.
function lokalitaZOdkazu(u) {
  const cesta = decodeURIComponent(u.pathname).split("/").filter(Boolean);
  if (u.hostname.endsWith("sreality.cz") && cesta[0] === "detail")  // /detail/prodej/byt/2+1/praha-zabehlice-postupicka/<id>
    return { typ: cesta[2], dispozice: cesta[3] !== "rodinny" ? cesta[3] : null, lokalita: (cesta[4] || "").replace(/-/g, " ").trim() };
  if (u.hostname.endsWith("idnes.cz") && cesta[0] === "detail")  // /detail/prodej/byt/praha-6-lindleyova/<id>/
    return { typ: cesta[2], dispozice: null, lokalita: (cesta[3] || "").replace(/-/g, " ").replace(/^praha \d+ /, "praha ").trim() };
  return null;
}

async function zpracujInzerat(inz) {
  nacitam("Hledám dům v registru adres a katastru…");
  const v = await najdiBudovuZInzeratu(inz);
  if (v.adresa) return zobrazBudovu(v.adresa, inz, v);
  if (v.kandidati.length) return nabidni(v.kandidati, "Vyberte dům z inzerátu", v.duvod, inz);
  $("vysledek").innerHTML = karta("upresnit", "Z inzerátu nejde určit dům", `<p>${esc(v.duvod)} Zadejte prosím adresu.</p>`);
}

async function overitOdkaz(url) {
  if (!PORTALY.some((p) => url.hostname.replace(/^www\./, "").endsWith(p))) {
    $("vysledek").innerHTML = karta("upresnit", "Tento portál zatím neumíme přečíst",
      `<p>Umíme Sreality, Bezrealitky a iDNES Reality. Zadejte prosím adresu nemovitosti.</p>`);
    return;
  }
  nacitam("Čtu inzerát…");
  // Sreality automatické čtení zakazují (robots.txt), skript na Cloudflaru je proto nečte.
  const inz = url.hostname.endsWith("sreality.cz") ? null : await nactiInzerat(url.href).catch((err) => { console.warn(err); return null; });
  if (inz) return zpracujInzerat(inz);

  // Portál čtení nedovolí (Sreality): z adresy odkazu známe typ a ulici, dům vybereme podle typu.
  const lok = lokalitaZOdkazu(url);
  const kand = lok?.lokalita ? (await geokoduj(lok.lokalita, 10)) : [];
  // Adresa v ulici má tvar „Ulice 12/3, Část obce, PSČ Obec“; bez ulice jen „Část obce 123, PSČ Obec“.
  const nazevUlice = (c) => c.address.split(",")[0].replace(/\s+\d+(\/\d+\w?)?$/, "");
  const ulice = kand.find((c) => c.attributes.Type === "AdresniMisto" && c.address.split(",").length >= 3
    && bezDiakritiky(lok.lokalita).includes(bezDiakritiky(nazevUlice(c))));  // geokodér jinak vrátí i jinou ulici v části obce
  if (ulice) {
    const nazev = nazevUlice(ulice);
    const obec = ulice.address.match(/Praha|[^,]+$/)?.[0]?.trim();
    const inzOdkaz = { typ: lok.typ, dispozice: lok.dispozice, ulice: nazev, obec, portal: url.hostname.replace(/^www\./, "") };
    const adresy = await adresyVUlici(nazev, obec, null);
    adresy.forEach((a) => { a.vzdalenost = null; });
    const poradi = (await ohodnot(adresy, inzOdkaz)).filter((x) => x.skore > 0);
    if (poradi.length === 1) return zobrazBudovu(poradi[0], inzOdkaz, { jak: "jediný dům v ulici, který sedí typem", jistota: "střední" });
    if (poradi.length) return nabidni(poradi.slice(0, 8), "Vyberte dům z inzerátu",
      `Portál nedovoluje inzerát přečíst automaticky, z odkazu známe jen ulici ${esc(nazev)}. ${TIP_ZALOZKA}`, inzOdkaz);
  }
  $("vysledek").innerHTML = karta("upresnit", "Z odkazu nejde vyčíst adresu", `<p>${TIP_ZALOZKA} Nebo zadejte adresu.</p>`);
}

async function overit(e) {
  e?.preventDefault();
  const tlacitko = document.querySelector("button[type=submit]");
  tlacitko.disabled = true;
  try {
    const text = $("vstup").value.trim();
    let url = null;
    try { url = new URL(text); } catch { /* adresa */ }
    if (url) return await overitOdkaz(url);

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

$("formular").addEventListener("submit", overit);

// Údaje ze záložky „Prověřit“.
if (location.hash.startsWith("#inzerat=")) {
  try {
    const inz = JSON.parse(decodeURIComponent(location.hash.slice(9)));
    history.replaceState(null, "", location.pathname + location.search);
    $("vstup").value = inz.url || "";
    zpracujInzerat(inz).catch(chyba);
  } catch (err) { chyba(new Error("Údaje ze záložky se nepodařilo přečíst")); }
}
