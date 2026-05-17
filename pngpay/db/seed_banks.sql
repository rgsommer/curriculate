-- Common banks in Papua New Guinea. Editable from the admin UI later.
INSERT OR IGNORE INTO banks (name, swift_code, sort_order) VALUES
  ('Bank South Pacific (BSP)',     'BOSPPGPM', 10),
  ('Kina Bank',                    'KINBPGPM', 20),
  ('Westpac PNG',                  'WPACPGPX', 30),
  ('ANZ PNG',                      'ANZBPGPX', 40),
  ('National Development Bank',    NULL,       50),
  ('MiBank',                       NULL,       60),
  ('Other / Cash',                 NULL,       99);
