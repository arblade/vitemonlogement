-- Réécrire les anciennes analyses qui mentionnaient « fourni par l'API » en langage courant.
UPDATE housing_listings SET
  features = REPLACE(REPLACE(features, 'Champ structuré « ', 'Indiqué dans l'annonce : « '), ' » fourni par l'API de l'annonce.', ' ».'),
  criterion_results = REPLACE(REPLACE(criterion_results, 'Champ structuré « ', 'Indiqué dans l'annonce : « '), ' » fourni par l'API de l'annonce.', ' ».');
--> statement-breakpoint
UPDATE listing_analyses SET
  general = REPLACE(REPLACE(general, 'Champ structuré « ', 'Indiqué dans l'annonce : « '), ' » fourni par l'API de l'annonce.', ' ».'),
  verdicts = REPLACE(REPLACE(verdicts, 'Champ structuré « ', 'Indiqué dans l'annonce : « '), ' » fourni par l'API de l'annonce.', ' ».');
