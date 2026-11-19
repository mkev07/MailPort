use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Profiles {
    pub items: Vec<Profile>,
    pub assignments: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub color: String,
    pub avatar: Avatar,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Avatar {
    Icon(String),
    Emoji(String),
    Image(String),
}

impl Profiles {
    pub fn contains(&self, id: &str) -> bool {
        self.items.iter().any(|profile| profile.id == id)
    }

    pub fn assign(&mut self, account_id: String, profile_id: Option<String>) -> Result<(), String> {
        if let Some(id) = profile_id {
            if !self.contains(&id) {
                return Err("That profile no longer exists.".into());
            }
            self.assignments.insert(account_id, id);
        } else {
            self.assignments.remove(&account_id);
        }
        Ok(())
    }

    pub fn save(&mut self, mut profile: Profile) -> Result<(), String> {
        profile.name = profile.name.trim().to_owned();
        if profile.name.is_empty()
            || profile.name.chars().count() > 40
            || profile.name.chars().any(char::is_control)
        {
            return Err("Enter a profile name of 1 to 40 characters.".into());
        }
        if profile.color.len() != 7
            || !profile.color.starts_with('#')
            || !profile.color.as_bytes()[1..]
                .iter()
                .all(u8::is_ascii_hexdigit)
        {
            return Err("Choose a valid background color.".into());
        }
        let valid_avatar = match &profile.avatar {
            Avatar::Icon(icon) => matches!(
                icon.as_str(),
                "person" | "work" | "home" | "star" | "globe" | "bolt"
            ),
            Avatar::Emoji(emoji) => {
                !emoji.trim().is_empty()
                    && emoji.chars().count() <= 16
                    && !emoji.chars().any(char::is_control)
            }
            Avatar::Image(image) => image
                .strip_prefix("data:image/png;base64,")
                .filter(|encoded| encoded.len() <= 88_000)
                .and_then(|encoded| STANDARD.decode(encoded).ok())
                .is_some_and(|bytes| {
                    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                        && bytes.get(12..24) == Some(b"IHDR\0\0\0\x60\0\0\0\x60")
                }),
        };
        if !valid_avatar {
            return Err("Choose a valid profile avatar.".into());
        }
        if profile.id.is_empty() {
            if self.items.len() >= 32 {
                return Err("A vault can contain up to 32 profiles.".into());
            }
            profile.id = uuid::Uuid::new_v4().to_string();
            self.items.push(profile);
        } else {
            let existing = self
                .items
                .iter_mut()
                .find(|item| item.id == profile.id)
                .ok_or("That profile no longer exists.")?;
            *existing = profile;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editing_and_moving_keep_stable_profile_identity() {
        let mut profiles = Profiles::default();
        let mut profile = Profile {
            id: String::new(),
            name: " Work ".into(),
            color: "#112233".into(),
            avatar: Avatar::Icon("work".into()),
        };
        profiles.save(profile.clone()).unwrap();
        profile.id = profiles.items[0].id.clone();
        assert_eq!(profiles.items[0].name, "Work");
        profiles
            .assign("account".into(), Some(profile.id.clone()))
            .unwrap();
        profile.name = "Business".into();
        profiles.save(profile.clone()).unwrap();
        assert_eq!(profiles.assignments.get("account"), Some(&profile.id));
        assert_eq!(profiles.items[0].name, "Business");
        assert!(profiles
            .assign("account".into(), Some("unknown".into()))
            .is_err());
        assert_eq!(profiles.assignments.get("account"), Some(&profile.id));
        profiles.assign("account".into(), None).unwrap();
        assert!(profiles.assignments.is_empty());
    }
}
