ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.users
  ALTER COLUMN password_hash DROP NOT NULL,
  ALTER COLUMN security_question DROP NOT NULL,
  ALTER COLUMN security_answer_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_idx ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.link_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_username text;
BEGIN
  requested_username := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'username'), ''), split_part(NEW.email, '@', 1));

  INSERT INTO public.users (auth_user_id, username, email, role, security_question)
  VALUES (NEW.id, requested_username, lower(NEW.email), 'customer', NEW.raw_user_meta_data ->> 'security_question')
  ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_link_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_link_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.link_auth_user_profile();

CREATE OR REPLACE FUNCTION public.set_app_user_role(p_user_id bigint, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_user public.users;
BEGIN
  IF public.current_app_role() <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('customer', 'staff') THEN
    RAISE EXCEPTION 'Role must be customer or staff.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET role = p_role, updated_at = now()
  WHERE id = p_user_id AND role <> 'admin'
  RETURNING * INTO updated_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found or administrator role cannot be changed.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(updated_user) - 'password_hash' - 'security_answer_hash';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_items jsonb,
  p_address text,
  p_phone text,
  p_whatsapp_number text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile public.users;
  item jsonb;
  product_row public.products;
  new_order public.orders;
  item_quantity integer;
  subtotal numeric(12, 2) := 0;
  item_price numeric(12, 2);
  delivery numeric(12, 2);
  order_lines jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order items are required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO profile FROM public.users WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Account profile not found.' USING ERRCODE = 'P0002'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    item_quantity := (item ->> 'quantity')::integer;
    IF item_quantity <= 0 THEN RAISE EXCEPTION 'Invalid order quantity.' USING ERRCODE = '22023'; END IF;

    SELECT * INTO product_row FROM public.products
    WHERE id = (item ->> 'productId')::bigint AND status = 'published'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product is unavailable.' USING ERRCODE = 'P0002'; END IF;
    IF product_row.stock < item_quantity THEN
      RAISE EXCEPTION 'Not enough stock for %.', product_row.name USING ERRCODE = '22023';
    END IF;

    item_price := CASE WHEN product_row.discount_price > 0 THEN product_row.discount_price ELSE product_row.price END;
    subtotal := subtotal + item_price * item_quantity;
    order_lines := order_lines || jsonb_build_array(jsonb_build_object('product_id', product_row.id, 'quantity', item_quantity, 'price', item_price));
  END LOOP;

  delivery := CASE WHEN subtotal >= 150000 THEN 0 ELSE 15000 END;
  INSERT INTO public.orders (user_id, total_amount, delivery_fee, status, address, phone, whatsapp_number, notes)
  VALUES (profile.id, subtotal + delivery, delivery, 'Pending', COALESCE(p_address, profile.address), COALESCE(p_phone, profile.phone), COALESCE(p_whatsapp_number, profile.phone), COALESCE(p_notes, ''))
  RETURNING * INTO new_order;

  FOR item IN SELECT value FROM jsonb_array_elements(order_lines)
  LOOP
    INSERT INTO public.order_items (order_id, product_id, quantity, price)
    VALUES (new_order.id, (item ->> 'product_id')::bigint, (item ->> 'quantity')::integer, (item ->> 'price')::numeric);
    UPDATE public.products
    SET stock = stock - (item ->> 'quantity')::integer, updated_at = now()
    WHERE id = (item ->> 'product_id')::bigint;
  END LOOP;

  RETURN jsonb_build_object('order', to_jsonb(new_order), 'items', order_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_store_order_status(p_order_id bigint, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_order public.orders;
  line public.order_items;
  product_row public.products;
BEGIN
  IF public.current_app_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Staff access required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('Pending', 'Confirmed', 'Processing', 'Ready', 'Shipped', 'Delivered', 'Sold/Completed', 'Cancelled') THEN
    RAISE EXCEPTION 'Invalid order status.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO target_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002'; END IF;

  IF target_order.status <> 'Cancelled' AND p_status = 'Cancelled' THEN
    FOR line IN SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
      UPDATE public.products SET stock = stock + line.quantity, updated_at = now() WHERE id = line.product_id;
    END LOOP;
  ELSIF target_order.status = 'Cancelled' AND p_status <> 'Cancelled' THEN
    FOR line IN SELECT * FROM public.order_items WHERE order_id = p_order_id
    LOOP
      SELECT * INTO product_row FROM public.products WHERE id = line.product_id FOR UPDATE;
      IF product_row.stock < line.quantity THEN
        RAISE EXCEPTION 'Not enough stock to reactivate order.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.products SET stock = stock - line.quantity, updated_at = now() WHERE id = line.product_id;
    END LOOP;
  END IF;

  UPDATE public.orders
  SET status = p_status,
      updated_at = now(),
      completed_at = CASE WHEN p_status = 'Sold/Completed' THEN now() ELSE NULL END
  WHERE id = p_order_id
  RETURNING * INTO target_order;

  RETURN to_jsonb(target_order);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_store_orders(p_order_id bigint DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_app_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Staff access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', o.id,
    'user_id', o.user_id,
    'total_amount', o.total_amount,
    'delivery_fee', o.delivery_fee,
    'status', o.status,
    'address', o.address,
    'phone', o.phone,
    'whatsapp_number', o.whatsapp_number,
    'notes', o.notes,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'completed_at', o.completed_at,
    'user', jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email, 'role', u.role, 'phone', u.phone),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'id', oi.id,
      'order_id', oi.order_id,
      'product_id', oi.product_id,
      'quantity', oi.quantity,
      'price', oi.price,
      'product_name', p.name,
      'product_image', p.images
    ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb)
  )
  FROM public.orders o
  INNER JOIN public.users u ON u.id = o.user_id
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE p_order_id IS NULL OR o.id = p_order_id
  GROUP BY o.id, u.id
  ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_store_customers()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_app_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Staff access required.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*) FROM public.users WHERE role = 'customer');
END;
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_self_or_staff ON public.users;
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.current_app_role() = 'admin');

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS categories_read_all ON public.categories;
CREATE POLICY categories_read_all ON public.categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS categories_manage_staff ON public.categories;
CREATE POLICY categories_manage_staff ON public.categories FOR ALL TO authenticated
  USING (public.current_app_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_app_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS products_read_published_or_staff ON public.products;
CREATE POLICY products_read_published_or_staff ON public.products FOR SELECT TO anon, authenticated
  USING (status = 'published' OR public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS products_manage_staff ON public.products;
CREATE POLICY products_manage_staff ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS products_update_staff ON public.products;
CREATE POLICY products_update_staff ON public.products FOR UPDATE TO authenticated
  USING (public.current_app_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS products_delete_staff ON public.products;
CREATE POLICY products_delete_staff ON public.products FOR DELETE TO authenticated
  USING (public.current_app_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS settings_read_all ON public.site_settings;
CREATE POLICY settings_read_all ON public.site_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS settings_manage_staff ON public.site_settings;
CREATE POLICY settings_manage_staff ON public.site_settings FOR ALL TO authenticated
  USING (public.current_app_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_app_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS orders_read_owner_or_staff ON public.orders;
CREATE POLICY orders_read_owner_or_staff ON public.orders FOR SELECT TO authenticated
  USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()) OR public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS orders_insert_owner ON public.orders;
CREATE POLICY orders_insert_owner ON public.orders FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));
DROP POLICY IF EXISTS orders_update_staff ON public.orders;
CREATE POLICY orders_update_staff ON public.orders FOR UPDATE TO authenticated
  USING (public.current_app_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_app_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS order_items_read_owner_or_staff ON public.order_items;
CREATE POLICY order_items_read_owner_or_staff ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND orders.user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
    OR public.current_app_role() IN ('admin', 'staff')
  );

REVOKE ALL ON public.users, public.categories, public.products, public.site_settings, public.orders, public.order_items FROM anon, authenticated;
GRANT SELECT ON public.categories, public.products, public.site_settings TO anon, authenticated;
GRANT SELECT, UPDATE (username, email, phone, address, profile_image, updated_at) ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories, public.products, public.site_settings TO authenticated;
GRANT SELECT ON public.orders, public.order_items TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_app_user_role(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order(jsonb, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_store_order_status(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_store_orders(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_store_customers() TO authenticated;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO anon;
REVOKE ALL ON FUNCTION public.link_auth_user_profile() FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-media', 'product-media', true, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_media_public_read ON storage.objects;
CREATE POLICY product_media_public_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'product-media');
DROP POLICY IF EXISTS product_media_staff_insert ON storage.objects;
CREATE POLICY product_media_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-media' AND public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS product_media_staff_update ON storage.objects;
CREATE POLICY product_media_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-media' AND public.current_app_role() IN ('admin', 'staff'))
  WITH CHECK (bucket_id = 'product-media' AND public.current_app_role() IN ('admin', 'staff'));
DROP POLICY IF EXISTS product_media_staff_delete ON storage.objects;
CREATE POLICY product_media_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-media' AND public.current_app_role() IN ('admin', 'staff'));