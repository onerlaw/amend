/// Implements `Serialize` for an error type by serializing its `Display` string.
/// The error type must implement `std::fmt::Display` (e.g., via `thiserror::Error`).
macro_rules! impl_serialize_as_string {
    ($ty:ty) => {
        impl serde::Serialize for $ty {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                serializer.serialize_str(&self.to_string())
            }
        }
    };
}

pub(crate) use impl_serialize_as_string;
