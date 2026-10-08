INSERT INTO public.categories (name, description)
VALUES
  ('Jalabia', 'Jalabia collection from Alubarika Home of Designs.'),
  ('Agbada', 'Agbada collection from Alubarika Home of Designs.'),
  ('T-Shirts', 'T-Shirts collection from Alubarika Home of Designs.'),
  ('Traditional Wear', 'Traditional Wear collection from Alubarika Home of Designs.'),
  ('Men''s Fashion', 'Men''s Fashion collection from Alubarika Home of Designs.'),
  ('New Arrivals', 'New Arrivals collection from Alubarika Home of Designs.'),
  ('Premium Designs', 'Premium Designs collection from Alubarika Home of Designs.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.site_settings (key, value)
VALUES
  ('heroImage', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80'),
  ('logoImage', '/download.png')
ON CONFLICT (key) DO NOTHING;