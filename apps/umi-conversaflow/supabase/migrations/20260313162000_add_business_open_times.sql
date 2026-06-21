ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS open_times JSONB NOT NULL DEFAULT jsonb_build_object(
  'timezone', 'America/Mexico_City',
  'days', jsonb_build_object(
    '0', jsonb_build_object('closed', true),
    '1', jsonb_build_object('open', '07:30', 'close', '20:00'),
    '2', jsonb_build_object('open', '07:30', 'close', '20:00'),
    '3', jsonb_build_object('open', '07:30', 'close', '20:00'),
    '4', jsonb_build_object('open', '07:30', 'close', '20:00'),
    '5', jsonb_build_object('open', '07:30', 'close', '20:00'),
    '6', jsonb_build_object('open', '07:30', 'close', '20:00')
  )
);

COMMENT ON COLUMN public.businesses.open_times IS
'Business operating hours by weekday. Format: {"timezone":"America/Mexico_City","days":{"0":{"closed":true},"1":{"open":"07:30","close":"20:00"}}}. WhatsApp order cutoff is enforced 30 minutes before close.';
