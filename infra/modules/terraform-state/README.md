# Terraform state module

Creates one private, versioned GCS bucket with uniform bucket-level access,
Public Access Prevention, and `prevent_destroy`. No irreversible retention
policy is configured. IAM is isolated per state perimeter.
