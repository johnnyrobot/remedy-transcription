use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PlaylistEntry {
    pub position: usize,
    pub video_id: Option<String>,
    pub url: Option<String>,
    pub title: String,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistPreview {
    pub title: String,
    pub url: String,
    pub entries: Vec<PlaylistEntry>,
}

/// Only pass a canonical YouTube playlist URL to the sidecar.
pub fn canonical_playlist_url(input: &str) -> Result<String, String> {
    let parsed = url::Url::parse(input.trim()).map_err(|_| "Invalid playlist URL")?;
    let host = parsed.host_str().unwrap_or("");
    if !matches!(parsed.scheme(), "http" | "https")
        || !matches!(
            host,
            "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be"
        )
    {
        return Err("Enter a YouTube playlist URL".into());
    }
    let id = parsed
        .query_pairs()
        .find(|(key, _)| key == "list")
        .map(|(_, value)| value.into_owned())
        .ok_or("The URL has no playlist (list=) parameter")?;
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid YouTube playlist ID".into());
    }
    Ok(format!("https://www.youtube.com/playlist?list={id}"))
}

pub fn parse_playlist(value: serde_json::Value, url: String) -> Result<PlaylistPreview, String> {
    let items = value
        .get("entries")
        .and_then(|v| v.as_array())
        .ok_or("YouTube did not return a playlist")?;
    let entries = items
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let id = entry
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|id| {
                    id.len() == 11
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                })
                .map(str::to_string);
            let title = entry
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Unavailable video")
                .to_string();
            let availability = entry.get("availability").and_then(|v| v.as_str());
            let unavailable_reason = if id.is_none() {
                Some("Video is unavailable".into())
            } else if matches!(
                availability,
                Some("private" | "premium_only" | "subscriber_only" | "needs_auth")
            ) || matches!(title.as_str(), "[Private video]" | "[Deleted video]")
            {
                Some("Video is private, deleted, or requires sign-in".into())
            } else {
                None
            };
            PlaylistEntry {
                position: index + 1,
                url: id
                    .as_ref()
                    .map(|id| format!("https://www.youtube.com/watch?v={id}")),
                video_id: id,
                title,
                unavailable_reason,
            }
        })
        .collect();
    Ok(PlaylistPreview {
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("YouTube playlist")
            .to_string(),
        url,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_playlist_and_watch_links_but_canonicalizes_to_the_playlist() {
        for input in [
            "https://www.youtube.com/playlist?list=PL_abc-123",
            "https://youtu.be/dQw4w9WgXcQ?list=PL_abc-123",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL_abc-123&index=5",
        ] {
            assert_eq!(
                canonical_playlist_url(input).unwrap(),
                "https://www.youtube.com/playlist?list=PL_abc-123"
            );
        }
        for input in [
            "https://youtube.com.evil.test/playlist?list=PL123",
            "file:///playlist?list=PL123",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/playlist?list=",
            "https://youtube.com/playlist?list=bad%26id",
        ] {
            assert!(canonical_playlist_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn retains_order_duplicates_and_unavailable_entries() {
        let preview = parse_playlist(
            json!({"title":"Course", "entries":[
                {"id":"dQw4w9WgXcQ", "title":"One"},
                null,
                {"id":"abcdefghijk", "title":"[Private video]"},
                {"id":"dQw4w9WgXcQ", "title":"One again"},
                {"id":"invalid", "title":"Broken"}
            ]}),
            "url".into(),
        )
        .unwrap();
        assert_eq!(preview.entries.len(), 5);
        assert_eq!(preview.entries[3].position, 4);
        assert_eq!(preview.entries[0].url, preview.entries[3].url);
        assert!(preview.entries[0].unavailable_reason.is_none());
        for i in [1, 2, 4] {
            assert!(preview.entries[i].unavailable_reason.is_some());
        }
        assert!(parse_playlist(json!({"id":"video"}), "url".into()).is_err());
    }
}
