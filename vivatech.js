const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    // Camouflage basique pour ressembler à un vrai navigateur Windows/Chrome
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }); 
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    console.log("Navigation vers la liste des exposants Mobility/Transportation...");
    await page.goto('https://vivatech.com/exhibitors?sectors=Mobility%2FTransportation', { waitUntil: 'networkidle', timeout: 60000 });
    
    console.log("Attente de 5s pour laisser le site charger ses scripts...");
    await page.waitForTimeout(5000); 

    // Défilement automatique vers le bas pour forcer l'apparition des 86 entreprises
    console.log("Défilement de la page (Scroll) pour charger toutes les fiches...");
    for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(1000); // Pause entre chaque coup de molette
    }

    console.log("Analyse de la page...");
    const exhibitors = await page.$$eval('a', links => {
        return links
            .filter(link => link.href && link.href.includes('/exhibitors/') && !link.href.includes('sectors='))
            .map(link => ({
                name: link.textContent.trim(),
                url: link.href
            }))
            .filter(e => e.name !== '' && e.name.length > 2);
    });

    const uniqueExhibitors = Array.from(new Map(exhibitors.map(item => [item.url, item])).values());
    console.log(`${uniqueExhibitors.length} sociétés uniques trouvées sur la page.`);

    // --- SÉCURITÉ DE DÉBOGAGE ---
    if (uniqueExhibitors.length === 0) {
        console.log("ERREUR : Aucune société trouvée. Vivatech bloque peut-être le serveur de GitHub (Cloudflare).");
        await page.screenshot({ path: 'debug-vivatech.png', fullPage: true });
        console.log("Une capture d'écran 'debug-vivatech.png' a été prise pour voir le problème.");
        fs.writeFileSync('Vivatech_Exhibitors_DGITM.csv', "\uFEFFSociété;Tags;Startup;Tech for Change;Pays;Stand;Résumé;URL;LinkedIn;URL Vivatech\n", 'utf8');
        await browser.close();
        return;
    }

    const results = [];

    // Boucle sur chaque fiche détaillée
    for (let i = 0; i < uniqueExhibitors.length; i++) {
        const { name, url } = uniqueExhibitors[i];
        console.log(`[${i + 1}/${uniqueExhibitors.length}] Traitement de : ${name}`);
        
        const detailPage = await context.newPage();
        try {
            await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Extraction des tags
            const tagsText = await detailPage.evaluate(() => {
                const elements = document.querySelectorAll('span, div');
                return Array.from(elements)
                    .map(el => el.textContent.trim())
                    .filter(t => t.length > 2 && t.length < 30) // Ne garder que les textes courts qui ressemblent à des tags
                    .join(', ');
            });
            const isStartup = tagsText.toLowerCase().includes('startup') ? 'Oui' : 'Non';
            const isTechForChange = tagsText.toLowerCase().includes('tech for change') ? 'Oui' : 'Non';

            // Extraction détaillée
            const data = await detailPage.evaluate(() => {
                const pageText = document.body.innerText;
                
                const extractLink = (domain) => {
                    const els = Array.from(document.querySelectorAll('a'));
                    const match = els.find(el => el.href && el.href.includes(domain));
                    return match ? match.href : '';
                };

                // Recherche de motifs dans le texte pour le Stand et le Pays
                const standMatch = pageText.match(/(Booth|Pavillon|Stand|Hall)\s[A-Z0-9\-]+/i);
                // On cherche le 1er paragraphe qui fait office de résumé
                const firstParagraph = document.querySelector('p');

                return {
                    country: "À vérifier dans le résumé", // Compliqué à isoler sans sélecteur CSS exact
                    stand: standMatch ? standMatch[0] : 'Non spécifié', 
                    summary: firstParagraph ? firstParagraph.textContent.trim() : '',
                    website: extractLink('http') && !extractLink('linkedin.com') ? extractLink('http') : '', 
                    linkedin: extractLink('linkedin.com')
                };
            });

            results.push({
                "Société": name,
                "Tags": "Voir fiches", // Simplifié pour éviter un tableau illisible
                "Startup": isStartup,
                "Tech for Change": isTechForChange,
                "Pays": data.country,
                "Stand": data.stand,
                "Résumé": data.summary.replace(/(\r\n|\n|\r|;)/gm, " "), // On nettoie le texte pour le CSV
                "URL": data.website,
                "LinkedIn": data.linkedin,
                "URL Vivatech": url
            });

        } catch (error) {
            console.error(`Erreur sur ${name}: ${error.message}`);
        } finally {
            await detailPage.close();
            // Pause aléatoire pour ne pas surcharger le serveur de Vivatech
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        }
    }

    await browser.close();

    // Génération du CSV
    const header = ["Société", "Tags", "Startup", "Tech for Change", "Pays", "Stand", "Résumé", "URL", "LinkedIn", "URL Vivatech"];
    const csvContent = [
        header.join(';'),
        ...results.map(row => header.map(col => `"${(row[col] || '').toString().replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    fs.writeFileSync('Vivatech_Exhibitors_DGITM.csv', "\uFEFF" + csvContent, 'utf8');
    console.log("Extraction terminée avec succès !");
})();
