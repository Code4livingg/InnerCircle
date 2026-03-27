import creator_reg_v5_xwnxp.aleo;

program access_control_v3_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    record JobSeekerAccess {
        owner: address,
    }

    record JobGiverAccess {
        owner: address,
    }

    struct MemberKey {
        member: address,
        circle_id: field,
    }

    record MembershipProof {
        owner: address,
        circle_id: field,
        member_key: field,
    }

    mapping members: field => bool;

    transition pay_job_seeker_access(private owner: address) -> JobSeekerAccess {
        return JobSeekerAccess { owner: owner };
    }

    transition pay_job_giver_access(private owner: address) -> JobGiverAccess {
        return JobGiverAccess { owner: owner };
    }

    transition check_access_valid(public subject: address, public scope_hint: u64) -> bool {
        assert_eq(subject, subject);
        assert_eq(scope_hint, scope_hint);
        return true;
    }

    function compute_member_key(member: address, circle_id: field) -> field {
        let key: MemberKey = MemberKey {
            member: member,
            circle_id: circle_id,
        };
        return BHP256::hash_to_field(key);
    }

    async transition add_member(
        public circle_id: field,
        public member_address: address,
    ) -> Future {
        let member_key: field = compute_member_key(member_address, circle_id);
        let auth: Future = creator_reg_v5_xwnxp.aleo/assert_circle_admin(circle_id, self.caller);
        return finalize_add_member(auth, member_key);
    }

    async function finalize_add_member(auth: Future, public member_key: field) {
        auth.await();
        members.set(member_key, true);
    }

    async transition remove_member(
        public circle_id: field,
        public member_address: address,
    ) -> Future {
        let member_key: field = compute_member_key(member_address, circle_id);
        let auth: Future = creator_reg_v5_xwnxp.aleo/assert_circle_admin(circle_id, self.caller);
        return finalize_remove_member(auth, member_key);
    }

    async function finalize_remove_member(auth: Future, public member_key: field) {
        auth.await();
        members.set(member_key, false);
    }

    async transition verify_membership(
        public circle_id: field,
    ) -> (MembershipProof, Future) {
        let member_key: field = compute_member_key(self.signer, circle_id);
        return (
            MembershipProof {
                owner: self.signer,
                circle_id: circle_id,
                member_key: member_key,
            },
            finalize_verify_member(member_key),
        );
    }

    async function finalize_verify_member(public member_key: field) {
        let is_member: bool = members.get_or_use(member_key, false);
        assert_eq(is_member, true);
    }
}
