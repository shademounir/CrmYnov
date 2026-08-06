output "bucket_names" {
  description = "Independent state buckets by perimeter."
  value       = { for perimeter, bucket in module.state : perimeter => bucket.name }
}
