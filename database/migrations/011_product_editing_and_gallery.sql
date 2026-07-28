BEGIN;

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  image_content bytea NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  sha256 text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_images_product_order_idx
  ON product_images(product_id, active, is_primary DESC, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_primary_uq
  ON product_images(product_id) WHERE active AND is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS product_images_active_hash_uq
  ON product_images(product_id, sha256) WHERE active;

-- Preserve every legacy single product image as the first gallery image.
INSERT INTO product_images (
  product_id, file_name, content_type, image_content, alt_text,
  width, height, sha256, sort_order, is_primary, active
)
SELECT
  p.id,
  p.image_file_name,
  p.image_content_type,
  p.image_content,
  COALESCE(NULLIF(p.image_alt_text,''), p.name),
  1,
  1,
  'legacy-' || md5(p.image_content),
  0,
  true,
  true
FROM products p
WHERE p.image_content IS NOT NULL
  AND p.image_file_name IS NOT NULL
  AND p.image_content_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_images image WHERE image.product_id=p.id AND image.active
  );

DROP TRIGGER IF EXISTS audit_product_images ON product_images;
CREATE TRIGGER audit_product_images
AFTER INSERT OR UPDATE OR DELETE ON product_images
FOR EACH ROW EXECUTE FUNCTION audit_change();

COMMIT;
