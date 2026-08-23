-- Stricter Google Maps URL validation for tables.maps_link (null allowed for legacy rows)

ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_maps_link_check;

ALTER TABLE public.tables ADD CONSTRAINT tables_maps_link_check
  CHECK (
    maps_link IS NULL
    OR maps_link ~* '^https?://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl/maps)'
  );

-- Populate wednesday_restaurants.maps_link from name + address (search URLs until exact share links are added)
UPDATE public.wednesday_restaurants
SET maps_link = 'https://www.google.com/maps/search/?api=1&query='
  || replace(replace(replace(name || ', ' || address || ', ' || city, ' ', '+'), '''', '%27'), ',', '%2C')
WHERE maps_link IS NULL;
