-- Les preuves enregistrées avant le nettoyage du vocabulaire disaient « Champ structuré « prix » fourni par l’API de l’annonce. » :
-- on les réécrit en « Indiqué dans l’annonce : « prix ». », comme le produit le code actuel. Les apostrophes sont typographiques (’).
UPDATE housing_listings SET
  features = REPLACE(REPLACE(features, 'Champ structuré « ', 'Indiqué dans l’annonce : « '), ' » fourni par l’API de l’annonce.', ' ».'),
  criterion_results = REPLACE(REPLACE(criterion_results, 'Champ structuré « ', 'Indiqué dans l’annonce : « '), ' » fourni par l’API de l’annonce.', ' ».')
WHERE features LIKE '%fourni par l’API de l’annonce%' OR criterion_results LIKE '%fourni par l’API de l’annonce%';
--> statement-breakpoint
UPDATE listing_analyses SET
  general = REPLACE(REPLACE(general, 'Champ structuré « ', 'Indiqué dans l’annonce : « '), ' » fourni par l’API de l’annonce.', ' ».'),
  verdicts = REPLACE(REPLACE(verdicts, 'Champ structuré « ', 'Indiqué dans l’annonce : « '), ' » fourni par l’API de l’annonce.', ' ».')
WHERE general LIKE '%fourni par l’API de l’annonce%' OR verdicts LIKE '%fourni par l’API de l’annonce%';
