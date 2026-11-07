# Web Před koupí (predkoupi.cz) – pravidla pro Claude

Web služby NEMO (prověření bytu a domu v Praze před koupí). Rozhodnutí a obsah služby: repozitář
`petgra-bot/automatic-enigma`, soubor `nemo/CLAUDE.md` (Balíčky a ceny, Zadání na webu, To-do W).
Česky, stručně, nelichotit, nesouhlas říct přímo.

## Zadání vzhledu (rozhodnutí Petra Gratzera, 6. 11. 2026)

Styl jako nekupnaslepo.cz: tmavě modrá `#1e2645` a bílá, světle šedé sekce `#f1f2f6`, písmo Montserrat,
velké tučné nadpisy verzálkami, malé šedé štítky nad nadpisy, ostré karty s tenkými linkami (bez zaoblení),
číslované kroky 01–04, tmavé boxy „Proč my“, ceník ve třech sloupcích s prostředním tmavým.
Vzor: `ukazka/index.html` (https://proverka.gratzer.cz/ukazka/).

**Toto zadání má přednost před obecnými doporučeními skillu `frontend-design`** (ten verzálkové štítky,
ostré rohy a číslování 01/02/03 považuje za šablonovité; skill sám říká, že výslovné zadání klienta vyhrává).
Ze skillu ber zbytek: texty z pohledu klienta, jasná tlačítka, přístupnost, mobil, kontrola snímkem obrazovky.

Styl přebíráme, texty, logo a obsah konkurence ne. Žádné vymyšlené recenze ani čísla.

## Skills v repozitáři

`.claude/skills/frontend-design` a `.claude/skills/webapp-testing` – z `anthropics/skills` (commit 2c5958e,
licence Apache 2.0, LICENSE.txt u každého). Aktualizace: znovu stáhnout, přečíst změny, pak teprve nahradit.
