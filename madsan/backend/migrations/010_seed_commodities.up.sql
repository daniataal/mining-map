INSERT INTO commodities (name, normalized_name, commodity_group, aliases, unit) VALUES
    ('Crude Oil', 'crude_oil', 'energy', ARRAY['crude','wti','brent'], 'bbl'),
    ('Diesel EN590', 'en590', 'energy', ARRAY['diesel','gasoil'], 'mt'),
    ('VLSFO', 'vlsfo', 'energy', ARRAY['very low sulfur fuel oil'], 'mt'),
    ('HSFO', 'hsfo', 'energy', ARRAY['high sulfur fuel oil'], 'mt'),
    ('MGO', 'mgo', 'energy', ARRAY['marine gas oil'], 'mt'),
    ('Jet Fuel', 'jet_fuel', 'energy', ARRAY['jet a1','aviation'], 'mt'),
    ('LNG', 'lng', 'energy', ARRAY['liquefied natural gas'], 'm3'),
    ('Gold', 'gold', 'metals', ARRAY['au','xau'], 'oz'),
    ('Silver', 'silver', 'metals', ARRAY['ag','xag'], 'oz'),
    ('Copper', 'copper', 'metals', ARRAY['cu'], 'mt')
ON CONFLICT (normalized_name) DO NOTHING;
