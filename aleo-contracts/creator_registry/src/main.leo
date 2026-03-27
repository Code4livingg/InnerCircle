import credits.aleo;

// Creator metadata registry that stores pricing hashes and circle ownership.
program creator_reg_v5_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    const TREASURY_ADDRESS: address = aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl;
    const CREATOR_COUNT_KEY: bool = true;
    const MIN_REG_FEE_MICROCREDITS: u64 = 1_000_000u64;

    mapping creators: address => bool;
    mapping creator_indexed: address => bool;
    mapping creator_count: bool => u64;
    mapping creator_ids: u64 => address;
    mapping creator_circle_ids: address => field;
    mapping circle_registered: field => bool;
    mapping circle_creators: field => address;
    mapping creator_content_count: address => u64;
    mapping subscription_price_hashes: address => field;
    mapping content_price_hashes: field => field;
    mapping content_registered: field => bool;
    mapping content_creator: field => address;

    async transition register_creator() -> Future {
        return finalize_register_creator(self.caller);
    }

    async function finalize_register_creator(public creator: address) {
        let already_registered: bool = creators.get_or_use(creator, false);
        assert_eq(already_registered, false);
        creators.set(creator, true);

        let indexed: bool = creator_indexed.get_or_use(creator, false);
        if indexed == false {
            let count: u64 = creator_count.get_or_use(CREATOR_COUNT_KEY, 0u64);
            creator_ids.set(count, creator);
            creator_count.set(CREATOR_COUNT_KEY, count + 1u64);
            creator_indexed.set(creator, true);
        }
    }

    async transition register_creator_paid(
        public circle_id: field,
        public registration_fee: u64,
    ) -> Future {
        assert(registration_fee >= MIN_REG_FEE_MICROCREDITS);
        let payment: Future = credits.aleo/transfer_public_as_signer(TREASURY_ADDRESS, registration_fee);
        return finalize_reg_paid(payment, self.caller, circle_id);
    }

    async function finalize_reg_paid(
        payment: Future,
        public creator: address,
        public circle_id: field,
    ) {
        let already_registered: bool = creators.get_or_use(creator, false);
        assert_eq(already_registered, false);
        let existing_circle: field = creator_circle_ids.get_or_use(creator, 0field);
        if existing_circle == 0field {
            let is_bound: bool = circle_registered.get_or_use(circle_id, false);
            if is_bound {
                let owner: address = circle_creators.get(circle_id);
                assert_eq(owner, creator);
            } else {
                circle_registered.set(circle_id, true);
                circle_creators.set(circle_id, creator);
            }
            creator_circle_ids.set(creator, circle_id);
        } else {
            assert_eq(existing_circle, circle_id);
        }
        payment.await();
        creators.set(creator, true);

        let indexed: bool = creator_indexed.get_or_use(creator, false);
        if indexed == false {
            let count: u64 = creator_count.get_or_use(CREATOR_COUNT_KEY, 0u64);
            creator_ids.set(count, creator);
            creator_count.set(CREATOR_COUNT_KEY, count + 1u64);
            creator_indexed.set(creator, true);
        }
    }

    async transition bind_creator_circle(public circle_id: field) -> Future {
        return finalize_bind_circle(self.caller, circle_id);
    }

    async function finalize_bind_circle(public creator: address, public circle_id: field) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        let existing_circle: field = creator_circle_ids.get_or_use(creator, 0field);
        if existing_circle == 0field {
            let is_bound: bool = circle_registered.get_or_use(circle_id, false);
            if is_bound {
                let owner: address = circle_creators.get(circle_id);
                assert_eq(owner, creator);
            } else {
                circle_registered.set(circle_id, true);
                circle_creators.set(circle_id, creator);
            }
            creator_circle_ids.set(creator, circle_id);
        } else {
            assert_eq(existing_circle, circle_id);
        }
    }

    async transition deactivate_creator() -> Future {
        return finalize_deactivate_creator(self.caller);
    }

    async function finalize_deactivate_creator(public creator: address) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        creators.set(creator, false);
    }

    async transition set_subscription_price(public price_hash: field) -> Future {
        return finalize_set_sub_price(self.caller, price_hash);
    }

    async function finalize_set_sub_price(public creator: address, public price_hash: field) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        subscription_price_hashes.set(creator, price_hash);
    }

    async transition register_content(public content_id: field, public price_hash: field) -> Future {
        return finalize_register_content(self.caller, content_id, price_hash);
    }

    async function finalize_register_content(
        public creator: address,
        public content_id: field,
        public price_hash: field,
    ) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);

        let exists: bool = content_registered.get_or_use(content_id, false);
        if exists {
            let owner: address = content_creator.get(content_id);
            assert_eq(owner, creator);
        } else {
            content_registered.set(content_id, true);
            content_creator.set(content_id, creator);

            let count: u64 = creator_content_count.get_or_use(creator, 0u64);
            creator_content_count.set(creator, count + 1u64);
        }

        content_price_hashes.set(content_id, price_hash);
    }

    async transition update_content_price(
        public content_id: field,
        public new_price_hash: field,
    ) -> Future {
        return finalize_update_price(self.caller, content_id, new_price_hash);
    }

    async function finalize_update_price(
        public creator: address,
        public content_id: field,
        public new_price_hash: field,
    ) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        let owner: address = content_creator.get(content_id);
        assert_eq(owner, creator);
        content_price_hashes.set(content_id, new_price_hash);
    }

    async transition assert_creator_active(public creator: address) -> Future {
        return finalize_assert_creator(creator);
    }

    async function finalize_assert_creator(public creator: address) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
    }

    async transition assert_circle_admin(
        public circle_id: field,
        public creator: address,
    ) -> Future {
        return finalize_circle_admin(circle_id, creator);
    }

    async function finalize_circle_admin(public circle_id: field, public creator: address) {
        let is_registered: bool = creators.get_or_use(creator, false);
        assert_eq(is_registered, true);
        let is_bound: bool = circle_registered.get_or_use(circle_id, false);
        assert_eq(is_bound, true);
        let owner: address = circle_creators.get(circle_id);
        assert_eq(owner, creator);
    }
}
