// Prověrka nemovitosti – krok 1: identifikace z adresy nebo odkazu na inzerát.
// Běží celé v prohlížeči nad veřejnými službami RÚIAN (ČÚZK), nic se neukládá.
const RUIAN = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN";
const GEOKODER = `${RUIAN}/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer/exts/GeocodeSOE/findAddressCandidates`;
const PROHLIZECI = `${RUIAN}/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer`;

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
const TYPY_INZERATU = { byt: "byt", dum: "rodinný dům", pozemek: "pozemek", komercni: "komerční prostor", ostatni: "ostatní" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function dotaz(url, params) {
  const r = await fetch(`${url}?${new URLSearchParams({ f: "json", ...params })}`);
  if (!r.ok) throw new Error(`Služba ČÚZK odpověděla ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Chyba služby ČÚZK");
  return data;
}

// Ze Sreality odkazu vyčteme typ, dispozici a lokalitu; číslo popisné v něm nebývá.
function rozeberInzerat(text) {
  let u;
  try { u = new URL(text.trim()); } catch { return null; }
  const cesta = decodeURIComponent(u.pathname).split("/").filter(Boolean);
  const vysledek = { url: u.href, portal: u.hostname.replace(/^www\./, ""), typ: null, dispozice: null, lokalita: null };
  if (vysledek.portal.endsWith("sreality.cz") && cesta[0] === "detail") {
    vysledek.typ = TYPY_INZERATU[cesta[2]] || cesta[2];
    vysledek.dispozice = cesta[3] && cesta[3] !== "rodinny" ? cesta[3] : null;
    vysledek.lokalita = cesta[4] ? cesta[4].replace(/-/g, " ") : null;
  }
  return vysledek;
}

async function geokoduj(text) {
  const data = await dotaz(GEOKODER, { SingleLine: text, outSR: 5514, maxLocations: 10 });
  return (data.candidates || []).filter((c) => c.score >= 90);
}

async function detailAdresy(kandidat) {
  const bod = JSON.stringify({ x: kandidat.location.x, y: kandidat.location.y, spatialReference: { wkid: 5514 } });
  const adresy = await dotaz(`${PROHLIZECI}/1/query`, {
    geometry: bod, geometryType: "esriGeometryPoint", inSR: 5514, spatialRel: "esriSpatialRelIntersects",
    distance: 1, units: "esriSRUnit_Meter", outFields: "kod,adresa,stavebniobjekt", returnGeometry: false,
  });
  const adresa = (adresy.features || []).find((f) => f.attributes.adresa === kandidat.address) || (adresy.features || [])[0];
  if (!adresa) throw new Error("Adresní místo se v RÚIAN nepodařilo načíst.");
  const so = await dotaz(`${PROHLIZECI}/3/query`, {
    where: `kod=${adresa.attributes.stavebniobjekt}`, outFields: "*", returnGeometry: false,
  });
  const budova = so.features?.[0]?.attributes;
  if (!budova) throw new Error("Budovu k adrese se v RÚIAN nepodařilo načíst.");
  let mc = null;
  if (budova.momc) {
    const m = await dotaz(`${PROHLIZECI}/8/query`, { where: `kod=${budova.momc}`, outFields: "nazev", returnGeometry: false });
    mc = m.features?.[0]?.attributes?.nazev || null;
  }
  return { adresa: adresa.attributes.adresa, kodAdresy: adresa.attributes.kod, budova, mestskaCast: mc };
}

function typNemovitosti(b) {
  const zpusob = ZPUSOB_VYUZITI[b.zpusobvyuzitikod] || "jiný";
  if (b.zpusobvyuzitikod === 6 || (b.pocetbytu || 0) > 3) return { typ: "bytový dům", zpusob };
  if ([2, 3, 7].includes(b.zpusobvyuzitikod)) return { typ: "rodinný dům", zpusob };
  return { typ: "jiná stavba", zpusob };
}

function karta(trida, nadpis, obsah) {
  return `<div class="karta ${trida}"><h2>${esc(nadpis)}</h2>${obsah}</div>`;
}

function zobrazKandidaty(kandidati, nadpis, uvod) {
  const adresy = kandidati.filter((c) => c.attributes.Type === "AdresniMisto");
  const ulice = kandidati.filter((c) => c.attributes.Type !== "AdresniMisto");
  const seznam = adresy.slice(0, 8).map((c, i) =>
    `<li><button type="button" data-i="${kandidati.indexOf(c)}">${esc(c.address)}</button></li>`).join("");
  const uliceText = ulice.length ? `<p class="tlumene">Odpovídající ulice: ${ulice.slice(0, 6).map((c) => esc(c.address)).join("; ")}.
    Doplňte číslo popisné nebo orientační.</p>` : "";
  $("vysledek").innerHTML = karta("upresnit", nadpis,
    `<p>${uvod}</p>${seznam ? `<ul class="kandidati">${seznam}</ul>` : ""}${uliceText}`);
  $("vysledek").querySelectorAll("button[data-i]").forEach((b) =>
    b.addEventListener("click", () => identifikujKandidata(kandidati[+b.dataset.i], posledniInzerat)));
}

let posledniInzerat = null;

async function identifikujKandidata(kandidat, inzerat) {
  $("vysledek").innerHTML = `<p class="tlumene">Načítám údaje o budově…</p>`;
  const d = await detailAdresy(kandidat);
  const b = d.budova;
  const { typ, zpusob } = typNemovitosti(b);
  const mimoPrahu = !/Praha/.test(d.adresa);
  const jednotka = $("jednotka").value.trim();
  const patro = $("patro").value.trim();

  const upozorneni = [];
  if (mimoPrahu) upozorneni.push("Zatím prověřujeme jen Prahu. Identifikace funguje, další kroky ale pro tuto obec zatím nejsou.");
  if (inzerat?.typ === "byt" && typ === "rodinný dům")
    upozorneni.push("Inzerát nabízí byt, ale na adrese je podle RÚIAN rodinný dům. Ověřte adresu.");
  if (inzerat?.typ === "rodinný dům" && typ === "bytový dům")
    upozorneni.push("Inzerát nabízí rodinný dům, ale na adrese je podle RÚIAN bytový dům. Ověřte adresu.");
  if (typ === "jiná stavba")
    upozorneni.push(`Budova je v RÚIAN vedená jako „${zpusob}“. Prověrka zatím umí byty a rodinné domy.`);

  let stav = "ok", nadpis = "Nemovitost je identifikovaná";
  if (typ === "bytový dům" && !/^\d+\/\d+$/.test(jednotka)) {
    stav = "upresnit"; nadpis = "Upřesněte číslo bytové jednotky";
    upozorneni.unshift(`V domě je ${b.pocetbytu || "více"} bytů. Pro prověrku bytu potřebujeme číslo jednotky ve tvaru
      č.p./číslo (např. ${esc(String(b.cisladomovni).split(",")[0].trim())}/12). Najdete ho na výpisu z katastru nebo se zeptejte realitní kanceláře.`);
  }
  if (typ === "jiná stavba") { stav = "upresnit"; nadpis = "Tento typ stavby zatím neprověřujeme"; }

  const rok = b.dokonceni ? new Date(b.dokonceni).getFullYear() : null;
  const radky = [
    ["Adresa", d.adresa],
    ["Městská část", d.mestskaCast || "–"],
    ["Typ", typ === zpusob ? typ : `${typ} (v RÚIAN: ${zpusob})`],
    ["Čísla popisná budovy", b.cisladomovni],
    ["Bytů v budově", b.pocetbytu ?? "–"],
    ["Podlaží", b.pocetpodlazi ?? "–"],
    ["Konstrukce", KONSTRUKCE[b.druhkonstrukcekod] || "–"],
    ["Výtah", VYTAH[b.vybavenivytahemkod] || "–"],
    ["Zastavěná plocha", b.zastavenaplocha ? `${b.zastavenaplocha} m²` : "–"],
    ["Dokončení (evidence)", rok && rok !== 1945 ? rok : "neuvedeno"],
  ];
  if (jednotka) radky.push(["Jednotka (zadaná)", jednotka]);
  if (patro) radky.push(["Podlaží (zadané)", patro]);
  if (inzerat) radky.push(["Inzerát", `${inzerat.typ || "–"}${inzerat.dispozice ? ", " + inzerat.dispozice : ""} (${inzerat.portal})`]);

  const tabulka = `<dl>${radky.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const pozn = upozorneni.map((u) => `<p class="poznamka">${u}</p>`).join("");
  const dalsi = stav === "ok"
    ? `<p class="tlumene">Další krok (rozbor katastru, povodní, hluku, územního plánu a ceny) zatím není zapojen.</p>` : "";
  $("vysledek").innerHTML = karta(stav, nadpis, tabulka + pozn + dalsi);
}

async function overit(e) {
  e.preventDefault();
  const tlacitko = e.submitter || document.querySelector("button[type=submit]");
  tlacitko.disabled = true;
  $("vysledek").innerHTML = `<p class="tlumene">Hledám v registru adres…</p>`;
  try {
    const text = $("vstup").value.trim();
    const inzerat = rozeberInzerat(text);
    posledniInzerat = inzerat;
    if (inzerat && !inzerat.lokalita) {
      $("vysledek").innerHTML = karta("upresnit", "Z odkazu nejde vyčíst adresu",
        `<p>Odkaz z portálu ${esc(inzerat.portal)} zatím neumíme přečíst. Zadejte prosím adresu nemovitosti (ulice, číslo, část obce).</p>`);
      return;
    }
    const kandidati = await geokoduj(inzerat ? inzerat.lokalita : text);
    const adresy = kandidati.filter((c) => c.attributes.Type === "AdresniMisto");
    if (!kandidati.length) {
      $("vysledek").innerHTML = karta("chyba", "Adresu se nepodařilo najít",
        `<p>V registru adres RÚIAN jsme nic nenašli. Zkontrolujte ulici a číslo, případně přidejte část obce.</p>`);
    } else if (inzerat) {
      zobrazKandidaty(kandidati, "Upřesněte adresu z inzerátu",
        `Inzerát (${esc(inzerat.typ || "nemovitost")}${inzerat.dispozice ? ", " + esc(inzerat.dispozice) : ""}) uvádí jen lokalitu
        „${esc(inzerat.lokalita)}“, bez čísla domu. Vyberte adresu, nebo ji zadejte přesně (ulice a číslo).`);
    } else if (adresy.length === 1 || (adresy.length > 1 && adresy[0].address === adresy[1]?.address)) {
      await identifikujKandidata(adresy[0], null);
    } else {
      zobrazKandidaty(kandidati, "Upřesněte adresu",
        adresy.length ? `Zadání odpovídá ${adresy.length} adresám. Vyberte správnou, nebo doplňte číslo či část obce.`
                      : `Našli jsme jen ulici, ne konkrétní dům.`);
    }
  } catch (err) {
    $("vysledek").innerHTML = karta("chyba", "Něco se nepovedlo", `<p>${esc(err.message)}. Zkuste to prosím znovu.</p>`);
  } finally {
    tlacitko.disabled = false;
  }
}

$("formular").addEventListener("submit", overit);
