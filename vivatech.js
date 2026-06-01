const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    // Mode non-headless pour éviter les blocages de sécurité de Vivatech
    const browser = await chromium.launch({ headless: false }); 
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Navigation vers la liste des exposants Mobility/Transportation...");
    await page.goto('https://vivatech.com/exhibitors?sectors=Mobility%2FTransportation', { waitUntil: 'domcontentloaded' });
    
    // Attendre que la liste soit chargée. 
    // (À ajuster : ajouter une boucle de scroll ou un clic sur "Voir plus" si nécessaire pour afficher les 86 sociétés).
    await page.waitForTimeout(5000); 

    console.log("Extraction des sociétés...");
    const exhibitors = await page.$$eval('a[href*="/exhibitors/"]', links => {
        return links.map(link => ({
            name: link.textContent.trim(),
            url: link.href
        })).filter(e => e.name !== '');
    });

    // Élimination stricte des doublons basée sur l'URL
    const uniqueExhibitors = Array.from(new Map(exhibitors.map(item => [item.url, item])).values());
    console.log(`${uniqueExhibitors.length} sociétés uniques trouvées. Début de la collecte des détails...`);

    const results = [];

    // Boucle sur chaque fiche détaillée
    for (let i = 0; i < uniqueExhibitors.length; i++) {
        const { name, url } = uniqueExhibitors[i];
        console.log(`[${i + 1}/${uniqueExhibitors.length}] Traitement de : ${name}`);
        
        const detailPage = await context.newPage();
        try {
            await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Collecte des tags et statuts
            const tagsText = await detailPage.evaluate(() => {
                const elements = document.querySelectorAll('.tag, [class*="category"], [class*="badge"]');
                return Array.from(elements).map(el => el.textContent.trim()).join(', ');
            });
            const isStartup = tagsText.toLowerCase().includes('startup') ? 'Oui' : 'Non';
            const isTechForChange = tagsText.toLowerCase().includes('tech for change') ? 'Oui' : 'Non';

            // Extraction des informations détaillées (Pays, Stand, Résumé, URL, LinkedIn)
            const data = await detailPage.evaluate(() => {
                const extractText = (selector) => {
                    const el = document.querySelector(selector);
                    return el ? el.textContent.trim().replace(/[\r\n]+/g, ' ') : '';
                };
                
                const extractLink = (selector, exclude = '') => {
                    const els = Array.from(document.querySelectorAll(selector));
                    const match = els.find(el => el.href && !el.href.includes(exclude));
                    return match ? match.href : '';
                };

                return {
                    // Les sélecteurs ci-dessous sont indicatifs et devront être ajustés selon le DOM exact
                    country: extractText('[class*="country"], [class*="location"]'), 
                    stand: extractText('[class*="booth"], [class*="stand"]'), 
                    summary: extractText('[class*="description"], [class*="about"]'),
                    website: extractLink('a[target="_blank"], a[rel="noopener"]', 'linkedin.com'), 
                    linkedin: extractLink('a[href*="linkedin.com"]')
                };
            });

            results.push({
                "Société": name,
                "Tags": tagsText,
                "Startup": isStartup,
                "Tech for Change": isTechForChange,
                "Pays": data.country,
                "Stand": data.stand,
                "Résumé": data.summary,
                "URL": data.website,
                "LinkedIn": data.linkedin,
                "URL Vivatech": url
            });

        } catch (error) {
            console.error(`Erreur sur la fiche ${name}: ${error.message}`);
        } finally {
            await detailPage.close();
            // Pause aléatoire pour reproduire un comportement humain et éviter les limitations anti-bots
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        }
    }

    await browser.close();

    // Génération du CSV formaté pour Excel (séparateur point-virgule et BOM UTF-8)
    const header = ["Société", "Tags", "Startup", "Tech for Change", "Pays", "Stand", "Résumé", "URL", "LinkedIn", "URL Vivatech"];
    const csvContent = [
        header.join(';'),
        ...results.map(row => header.map(col => {
            // Remplacement strict des guillemets pour ne pas briser la structure du CSV
            const field = (row[col] || '').toString().replace(/"/g, '""');
            return `"${field}"`;
        }).join(';'))
    ].join('\n');

    fs.writeFileSync('Vivatech_Exhibitors_DGITM.csv', "\uFEFF" + csvContent, 'utf8');
    console.log("Extraction terminée. Le fichier Vivatech_Exhibitors_DGITM.csv a été créé avec succès.");
})();
